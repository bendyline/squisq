/**
 * Mic capture + PCM transport for the teleprompter.
 *
 * getUserMedia → AudioContext → AudioWorklet tap → subscriber callbacks
 * with 1024-sample Float32Array hops on the main thread. The DSP itself
 * lives in core (`@bendyline/squisq/narration`) — this hook only moves
 * samples. Falls back to a ScriptProcessorNode when `audioWorklet` is
 * unavailable (same push model, so pacing still isn't tied to rAF).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestMicStream } from '../recorder/sources/micStream';
import { PCM_WORKLET_NAME, registerPcmWorklet } from './pcmWorklet';

export type MicAnalysisStatus = 'idle' | 'starting' | 'live' | 'error';

export type PcmHopListener = (pcm: Float32Array, audioTimeSec: number) => void;

export interface MicAnalysisHandle {
  status: MicAnalysisStatus;
  error: Error | null;
  /** The live mic stream (feeds the narration recorder too), or null. */
  stream: MediaStream | null;
  /** AudioContext sample rate once live. */
  sampleRate: number | null;
  /** Known audio inputs (labels appear after the first grant). */
  devices: MediaDeviceInfo[];
  /**
   * Start (or restart) capture. Resolves with the live stream — callers
   * that need it immediately must use the return value, not the `stream`
   * state field, which only updates on the NEXT render (stale-closure
   * hazard right after an await). Null on failure/supersession.
   */
  start: (deviceId: string | null) => Promise<MediaStream | null>;
  stop: () => void;
  /** Subscribe to PCM hops; returns an unsubscribe. */
  subscribeHop: (listener: PcmHopListener) => () => void;
}

interface LiveGraph {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode | ScriptProcessorNode;
  /** Keeps ScriptProcessor pulling without audible output. */
  sink: GainNode | null;
}

export function useMicAnalysis(): MicAnalysisHandle {
  const [status, setStatus] = useState<MicAnalysisStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const graphRef = useRef<LiveGraph | null>(null);
  const listenersRef = useRef<Set<PcmHopListener>>(new Set());
  const generationRef = useRef(0);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'audioinput'));
    } catch {
      // Enumeration is best-effort; the default device still works.
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  const teardown = useCallback(() => {
    const graph = graphRef.current;
    graphRef.current = null;
    if (!graph) return;
    try {
      if ('port' in graph.node) {
        graph.node.port.onmessage = null;
      } else {
        (graph.node as ScriptProcessorNode).onaudioprocess = null;
      }
      graph.node.disconnect();
      graph.source.disconnect();
      graph.sink?.disconnect();
    } catch {
      // Best-effort teardown; the context close below is what matters.
    }
    for (const track of graph.stream.getTracks()) track.stop();
    void graph.context.close().catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    teardown();
    setStream(null);
    setSampleRate(null);
    setStatus('idle');
    setError(null);
  }, [teardown]);

  const start = useCallback(
    async (deviceId: string | null): Promise<MediaStream | null> => {
      const generation = ++generationRef.current;
      teardown();
      setStatus('starting');
      setError(null);
      try {
        const micStream = await requestMicStream(
          deviceId ? { deviceId: { exact: deviceId } } : undefined,
        );
        if (generation !== generationRef.current) {
          for (const track of micStream.getTracks()) track.stop();
          return null;
        }
        const context = new AudioContext();
        // Autoplay policy can start contexts suspended when creation lands
        // after an await; resume explicitly (we're inside a user gesture).
        if (context.state === 'suspended') {
          await context.resume().catch(() => undefined);
        }
        const source = context.createMediaStreamSource(micStream);
        const emit = (pcm: Float32Array, audioTime: number) => {
          for (const listener of listenersRef.current) listener(pcm, audioTime);
        };

        let node: AudioWorkletNode | ScriptProcessorNode | null = null;
        let sink: GainNode | null = null;
        if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
          try {
            await registerPcmWorklet(context);
            const workletNode = new AudioWorkletNode(context, PCM_WORKLET_NAME, {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              channelCount: 1,
              channelCountMode: 'explicit',
            });
            workletNode.port.onmessage = (event: MessageEvent) => {
              const data = event.data as { pcm?: Float32Array; audioTime?: number };
              if (data && data.pcm instanceof Float32Array) {
                emit(data.pcm, typeof data.audioTime === 'number' ? data.audioTime : 0);
              }
            };
            source.connect(workletNode);
            // The graph must reach the destination or the browser may never
            // pull (process) the tap; a zero-gain sink keeps it silent.
            sink = context.createGain();
            sink.gain.value = 0;
            workletNode.connect(sink);
            sink.connect(context.destination);
            node = workletNode;
          } catch {
            node = null;
          }
        }
        if (node === null) {
          // Degraded fallback: ScriptProcessor still pushes PCM off the
          // audio clock (not rAF), just with more main-thread overhead.
          const processor = context.createScriptProcessor(1024, 1, 1);
          processor.onaudioprocess = (event: AudioProcessingEvent) => {
            const input = event.inputBuffer.getChannelData(0);
            emit(new Float32Array(input), event.playbackTime);
          };
          sink = context.createGain();
          sink.gain.value = 0;
          source.connect(processor);
          processor.connect(sink);
          sink.connect(context.destination);
          node = processor;
        }

        if (generation !== generationRef.current) {
          for (const track of micStream.getTracks()) track.stop();
          void context.close().catch(() => undefined);
          return null;
        }
        graphRef.current = { stream: micStream, context, source, node, sink };
        setStream(micStream);
        setSampleRate(context.sampleRate);
        setStatus('live');
        void refreshDevices();
        return micStream;
      } catch (err: unknown) {
        if (generation !== generationRef.current) return null;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
        return null;
      }
    },
    [refreshDevices, teardown],
  );

  const subscribeHop = useCallback((listener: PcmHopListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // Full teardown when the owning view unmounts.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      teardown();
    };
  }, [teardown]);

  return { status, error, stream, sampleRate, devices, start, stop, subscribeHop };
}

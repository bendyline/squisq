import { Input, FilePathSource, ALL_FORMATS, EncodedPacketSink } from 'mediabunny';
for (const path of process.argv.slice(2)) {
  const input = new Input({ source: new FilePathSource(path), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  console.log('==', path.split('/').pop(), track?.codec, track?.displayWidth + 'x' + track?.displayHeight, 'duration', (await input.computeDuration()).toFixed(1));
  const sink = new EncodedPacketSink(track);
  const keys = [];
  const t0 = Date.now();
  let packet = await sink.getFirstPacket({ metadataOnly: true });
  if (packet && packet.type !== 'key') packet = await sink.getNextKeyPacket(packet, { metadataOnly: true });
  while (packet && keys.length < 5000) {
    keys.push(packet.timestamp);
    packet = await sink.getNextKeyPacket(packet, { metadataOnly: true });
  }
  const gaps = keys.slice(1).map((t, i) => t - keys[i]);
  console.log('keyframes', keys.length, 'first', keys.slice(0, 5).map((t) => t.toFixed(1)).join(','), 'max gap', Math.max(0, ...gaps).toFixed(1), 'median gap', (gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0).toFixed(1), 'scan ms', Date.now() - t0);
  const probe = Date.now();
  const key = await sink.getKeyPacket(260, { metadataOnly: true });
  console.log('key packet at/before 260s ->', key?.timestamp.toFixed(1), 'lookup ms', Date.now() - probe);
  input.dispose?.();
}

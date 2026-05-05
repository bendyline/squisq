/**
 * Demo page for `<JsonEditor>` and `<JsonView>`. Lets the developer
 * pick from several sample schemas and toggle between view & edit
 * modes against a live theme switch.
 */

import { useMemo, useState } from 'react';
import { JsonView } from '@bendyline/squisq-react';
import { JsonEditor } from '@bendyline/squisq-editor-react';
import {
  resolveTheme,
  getThemeSummaries,
  type Theme,
  type SurfaceScheme,
} from '@bendyline/squisq/schemas';
import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';
import { JSON_EDITOR_SAMPLES, type JsonEditorSample } from './jsonEditorSamples';

const sampleKeys = Object.keys(JSON_EDITOR_SAMPLES);

export function JsonEditorDemo() {
  const [sampleKey, setSampleKey] = useState<string>(sampleKeys[0]);
  const sample: JsonEditorSample = JSON_EDITOR_SAMPLES[sampleKey];
  const [value, setValue] = useState<unknown>(() => sample.initial);
  const [themeId, setThemeId] = useState<string>('standard');
  const [surface, setSurface] = useState<'auto' | 'light' | 'dark'>('auto');
  const [mode, setMode] = useState<'edit' | 'view' | 'split'>('split');

  const theme: Theme = useMemo(() => resolveTheme(themeId), [themeId]);
  const themeSummaries = useMemo(() => getThemeSummaries(), []);
  const surfaceProp: SurfaceScheme | 'auto' | undefined = surface === 'auto' ? 'auto' : surface;

  const handleSampleChange = (key: string) => {
    setSampleKey(key);
    setValue(JSON_EDITOR_SAMPLES[key].initial);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: theme.colors.background,
        color: theme.colors.text,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '8px 16px',
          alignItems: 'center',
          flexWrap: 'wrap',
          borderBottom: '1px solid rgba(127,127,127,0.3)',
          background: 'rgba(127,127,127,0.06)',
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: 13 }}>JSON Editor demo</strong>
        <label style={{ fontSize: 12 }}>
          Sample:&nbsp;
          <select value={sampleKey} onChange={(e) => handleSampleChange(e.target.value)}>
            {sampleKeys.map((k) => (
              <option key={k} value={k}>
                {JSON_EDITOR_SAMPLES[k].label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Theme:&nbsp;
          <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
            {themeSummaries.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Surface:&nbsp;
          <select value={surface} onChange={(e) => setSurface(e.target.value as never)}>
            <option value="auto">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Mode:&nbsp;
          <select value={mode} onChange={(e) => setMode(e.target.value as never)}>
            <option value="split">Editor + Viewer</option>
            <option value="edit">Editor only</option>
            <option value="view">Viewer only</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setValue(sample.initial)}
          style={{ fontSize: 12, padding: '3px 10px', cursor: 'pointer' }}
        >
          Reset value
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {mode !== 'view' ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 13, opacity: 0.7 }}>Editor</h3>
            <JsonEditor
              schema={sample.schema as SquisqAnnotatedSchema}
              value={value}
              onChange={setValue}
              theme={theme}
              surface={surfaceProp}
            />
          </div>
        ) : null}
        {mode !== 'edit' ? (
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 16,
              borderLeft: mode === 'split' ? '1px solid rgba(127,127,127,0.3)' : 'none',
            }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: 13, opacity: 0.7 }}>Viewer</h3>
            <JsonView
              schema={sample.schema as SquisqAnnotatedSchema}
              value={value}
              theme={theme}
              surface={surfaceProp}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

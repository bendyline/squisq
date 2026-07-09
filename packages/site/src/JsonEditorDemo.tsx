/**
 * Demo page for `<JsonEditor>` and `<JsonView>`. Lets the developer
 * pick from several sample schemas and toggle between view & edit
 * modes against a live theme switch.
 */

import { useMemo, useState } from 'react';
import { JsonView } from '@bendyline/squisq-react';
import { JsonEditor, type EditorColorScheme } from '@bendyline/squisq-editor-react';
import {
  resolveTheme,
  getThemeSummaries,
  LIGHT_SURFACE,
  DARK_SURFACE,
  type Theme,
  type SurfaceScheme,
} from '@bendyline/squisq/schemas';
import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';
import { JSON_EDITOR_SAMPLES, type JsonEditorSample } from './jsonEditorSamples';

const sampleKeys = Object.keys(JSON_EDITOR_SAMPLES);

interface JsonEditorDemoProps {
  colorScheme: EditorColorScheme;
}

export function JsonEditorDemo({ colorScheme }: JsonEditorDemoProps) {
  const [sampleKey, setSampleKey] = useState<string>(sampleKeys[0]);
  const sample: JsonEditorSample = JSON_EDITOR_SAMPLES[sampleKey];
  const [value, setValue] = useState<unknown>(() => sample.initial);
  const [themeId, setThemeId] = useState<string>('standard');
  const [surface, setSurface] = useState<'auto' | 'light' | 'dark'>('auto');
  const [mode, setMode] = useState<'edit' | 'view' | 'split'>('split');

  const theme: Theme = useMemo(() => resolveTheme(themeId), [themeId]);
  const themeSummaries = useMemo(() => getThemeSummaries(), []);
  const surfaceProp: SurfaceScheme =
    surface === 'auto'
      ? colorScheme === 'dark'
        ? DARK_SURFACE
        : LIGHT_SURFACE
      : surface === 'light'
        ? LIGHT_SURFACE
        : DARK_SURFACE;
  const isDarkSurface = surfaceProp.id === 'dark';
  const borderColor = isDarkSurface ? '#4a5568' : '#d1d5db';
  const controlStyle = {
    color: surfaceProp.text,
    background: surfaceProp.backgroundLight,
    border: `1px solid ${borderColor}`,
  } as const;

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
        colorScheme: isDarkSurface ? 'dark' : 'light',
        background: surfaceProp.background,
        color: surfaceProp.text,
        transition: 'background 0.2s, color 0.2s',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '8px 16px',
          alignItems: 'center',
          flexWrap: 'wrap',
          borderBottom: `1px solid ${borderColor}`,
          background: surfaceProp.backgroundLight,
          flexShrink: 0,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        <strong style={{ fontSize: 13 }}>JSON Editor demo</strong>
        <label style={{ fontSize: 12 }}>
          Sample:&nbsp;
          <select
            value={sampleKey}
            onChange={(e) => handleSampleChange(e.target.value)}
            style={controlStyle}
          >
            {sampleKeys.map((k) => (
              <option key={k} value={k}>
                {JSON_EDITOR_SAMPLES[k].label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Theme:&nbsp;
          <select value={themeId} onChange={(e) => setThemeId(e.target.value)} style={controlStyle}>
            {themeSummaries.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Surface:&nbsp;
          <select
            value={surface}
            onChange={(e) => setSurface(e.target.value as never)}
            style={controlStyle}
          >
            <option value="auto">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Mode:&nbsp;
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as never)}
            style={controlStyle}
          >
            <option value="split">Editor + Viewer</option>
            <option value="edit">Editor only</option>
            <option value="view">Viewer only</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setValue(sample.initial)}
          style={{
            ...controlStyle,
            fontSize: 12,
            padding: '3px 10px',
            cursor: 'pointer',
          }}
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
              borderLeft: mode === 'split' ? `1px solid ${borderColor}` : 'none',
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

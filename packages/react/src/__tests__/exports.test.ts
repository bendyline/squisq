import { describe, it, expect } from 'vitest';
import * as squisqReact from '../index';

describe('@bendyline/squisq-react exports', () => {
  it('exports DocPlayer component', () => {
    expect(squisqReact.DocPlayer).toBeDefined();
    expect(typeof squisqReact.DocPlayer).toBe('function');
  });

  it('exports BlockRenderer component', () => {
    expect(squisqReact.BlockRenderer).toBeDefined();
    expect(typeof squisqReact.BlockRenderer).toBe('function');
  });

  it('exports all layer components', () => {
    expect(typeof squisqReact.ImageLayer).toBe('function');
    expect(typeof squisqReact.TextLayer).toBe('function');
    expect(typeof squisqReact.ShapeLayer).toBe('function');
    expect(typeof squisqReact.VideoLayer).toBe('function');
    expect(typeof squisqReact.MapLayer).toBe('function');
  });

  it('exports control components', () => {
    expect(typeof squisqReact.CaptionOverlay).toBe('function');
    expect(typeof squisqReact.DocControlsOverlay).toBe('function');
    expect(typeof squisqReact.DocControlsBottom).toBe('function');
    expect(typeof squisqReact.DocControlsSidebar).toBe('function');
    expect(typeof squisqReact.DocControlsSlideshow).toBe('function');
    expect(typeof squisqReact.DocPlayerWithSidebar).toBe('function');
    expect(typeof squisqReact.DocProgressBar).toBe('function');
  });

  it('exports MarkdownRenderer and LinearDocView', () => {
    expect(typeof squisqReact.MarkdownRenderer).toBe('function');
    expect(typeof squisqReact.LinearDocView).toBe('function');
  });

  it('exports hooks', () => {
    expect(typeof squisqReact.useAudioSync).toBe('function');
    expect(typeof squisqReact.useDocPlayback).toBe('function');
    expect(typeof squisqReact.useViewportOrientation).toBe('function');
  });

  it('exports utility functions', () => {
    expect(typeof squisqReact.getAnimationStyle).toBe('function');
    expect(typeof squisqReact.getTransitionClass).toBe('function');
  });

  it('exports formatTime utility', () => {
    expect(typeof squisqReact.formatTime).toBe('function');
    expect(squisqReact.formatTime(65)).toBe('1:05');
    expect(squisqReact.formatTime(0)).toBe('0:00');
    expect(squisqReact.formatTime(3661)).toBe('61:01');
  });
});

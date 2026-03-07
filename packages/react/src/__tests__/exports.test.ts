import { describe, it, expect } from 'vitest';
import * as prodcoreReact from '../index';

describe('@bendyline/prodcore-react exports', () => {
  it('exports DocPlayer component', () => {
    expect(prodcoreReact.DocPlayer).toBeDefined();
    expect(typeof prodcoreReact.DocPlayer).toBe('function');
  });

  it('exports BlockRenderer component', () => {
    expect(prodcoreReact.BlockRenderer).toBeDefined();
    expect(typeof prodcoreReact.BlockRenderer).toBe('function');
  });

  it('exports all layer components', () => {
    expect(typeof prodcoreReact.ImageLayer).toBe('function');
    expect(typeof prodcoreReact.TextLayer).toBe('function');
    expect(typeof prodcoreReact.ShapeLayer).toBe('function');
    expect(typeof prodcoreReact.VideoLayer).toBe('function');
    expect(typeof prodcoreReact.MapLayer).toBe('function');
  });

  it('exports control components', () => {
    expect(typeof prodcoreReact.CaptionOverlay).toBe('function');
    expect(typeof prodcoreReact.DocControlsOverlay).toBe('function');
    expect(typeof prodcoreReact.DocControlsBottom).toBe('function');
    expect(typeof prodcoreReact.DocControlsSidebar).toBe('function');
    expect(typeof prodcoreReact.DocPlayerWithSidebar).toBe('function');
    expect(typeof prodcoreReact.DocProgressBar).toBe('function');
  });

  it('exports hooks', () => {
    expect(typeof prodcoreReact.useAudioSync).toBe('function');
    expect(typeof prodcoreReact.useDocPlayback).toBe('function');
    expect(typeof prodcoreReact.useViewportOrientation).toBe('function');
  });

  it('exports utility functions', () => {
    expect(typeof prodcoreReact.getAnimationStyle).toBe('function');
    expect(typeof prodcoreReact.getTransitionClass).toBe('function');
  });

  it('exports formatTime utility', () => {
    expect(typeof prodcoreReact.formatTime).toBe('function');
    expect(prodcoreReact.formatTime(65)).toBe('1:05');
    expect(prodcoreReact.formatTime(0)).toBe('0:00');
    expect(prodcoreReact.formatTime(3661)).toBe('61:01');
  });
});

import type { Locator } from '@playwright/test';

/** Measure the rendered SVG strokes, including CSS filter and SVG alpha, on
 * the navbar's opaque background. This catches invisible menu glyphs. */
export async function navigationIconContrast(icon: Locator): Promise<number> {
  return icon.evaluate(async node => {
    const style = getComputedStyle(node);
    const background = getComputedStyle(node.closest('.app-navigation')!).backgroundColor;
    const source = style.backgroundImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
    const drawable = new Image();
    await new Promise<void>((resolve, reject) => { drawable.onload = () => resolve(); drawable.onerror = reject; drawable.src = source; });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, 32, 32);
    const back = [...context.getImageData(0, 0, 1, 1).data];
    context.clearRect(0, 0, 32, 32);
    context.filter = style.filter;
    context.drawImage(drawable, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, value, index) => {
      const channel = value / 255;
      return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    let maximum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (!pixels[index + 3]) continue;
      const alpha = pixels[index + 3] / 255;
      const foreground = [0, 1, 2].map(channel => pixels[index + channel] * alpha + back[channel] * (1 - alpha));
      const values = [luminance(foreground), luminance(back)].sort((a, b) => a - b);
      maximum = Math.max(maximum, (values[1] + 0.05) / (values[0] + 0.05));
    }
    return maximum;
  });
}

/** Solid CSS colors composited through every ancestor, including group opacity.
 * Gradients/images are reported as unsupported instead of silently ignored. */
export async function textContrast(locator: Locator) {
  return locator.evaluate(node => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const value = [...context.getImageData(0, 0, 1, 1).data];
      return [value[0], value[1], value[2], value[3] / 255];
    };
    const over = (front: number[], back: number[]): number[] => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return alpha === 0 ? [0, 0, 0, 0] : [0, 1, 2].map(index =>
        (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha);
    };
    let foreground = rgba(getComputedStyle(node).color);
    let background = [0, 0, 0, 0];
    const unsupportedImages: string[] = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.backgroundImage !== 'none') unsupportedImages.push(style.backgroundImage);
      const layer = rgba(style.backgroundColor);
      foreground = over(foreground, layer);
      background = over(background, layer);
      foreground[3] *= Number(style.opacity);
      background[3] *= Number(style.opacity);
    }
    foreground = over(foreground, [255, 255, 255, 1]);
    background = over(background, [255, 255, 255, 1]);
    const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, value, index) => {
      const channel = value / 255;
      return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    return { ratio: (values[1] + 0.05) / (values[0] + 0.05), foreground, background, unsupportedImages };
  });
}

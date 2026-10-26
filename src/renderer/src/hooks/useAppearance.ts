import { useEffect } from 'react';
import { useSettings, type Settings } from '../services/Settings';

const UI_FONTS: Record<Settings['uiFont'], string> = {
  system: '',
  segoe: "'Segoe UI', sans-serif",
  arial: 'Arial, sans-serif',
  verdana: 'Verdana, sans-serif',
};
const CODE_FONTS: Record<Settings['codeFont'], string> = {
  system: '',
  consolas: 'Consolas, monospace',
  cascadia: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
  courier: "'Courier New', monospace",
};

/** Applies the theme, fonts and text size chosen in Settings to the whole window. */
export function useAppearance(): void {
  const { theme, uiFont, codeFont, textSize } = useSettings();
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && Boolean(media?.matches));
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (theme !== 'system' || !media) return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const style = document.documentElement.style;
    for (const [property, value] of [
      ['--font-family', UI_FONTS[uiFont]],
      ['--font-mono', CODE_FONTS[codeFont]],
    ])
      if (value) style.setProperty(property, value);
      else style.removeProperty(property);
  }, [uiFont, codeFont]);
  useEffect(() => {
    window.electronAPI?.app?.setZoom?.(textSize / 100);
  }, [textSize]);
}

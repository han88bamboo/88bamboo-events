export function dynamicRouteParam(ctx, key) {
  const fromPath = dynamicParamFromPath(ctx?.req?.url);
  if (fromPath) return fromPath;

  const value = ctx?.params?.[key];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  return value ? String(value) : '';
}

function dynamicParamFromPath(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  try {
    const { pathname } = new URL(rawUrl, 'http://localhost');
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    if (!last || last === 'index.json') return '';

    return decodeURIComponent(last.replace(/\.json$/, ''));
  } catch {
    return '';
  }
}

import { Fragment, type ReactNode } from 'react';

/**
 * `{name}` placeholder substitution for translated strings, in both the plain
 * and the React-node flavour.
 *
 * Its own module rather than living beside the provider, because the KPI info
 * panel needs `interpolateNodes` directly and a component file may not export
 * anything but components without breaking fast refresh.
 */

/** Replaces `{name}` placeholders. Five lines, and it covers every case we have. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * The same interpolation, but a placeholder may be a React node.
 *
 * This exists so a caller can style *part* of a translated sentence - the KPI
 * strip colours the figure in "83.1% of connected fleet" and leaves the words
 * plain - without splitting the sentence across two dictionary keys.
 *
 * That splitting is the thing worth avoiding. `'{pct}' + 'kpi.share.suffix'`
 * happens to read correctly in English and Thai and silently breaks in any
 * language that puts the qualifier first; worse, a translator handed the
 * fragments has no way to see they belong to one sentence.
 *
 * Only node params need keys - React does not ask for them on bare strings in
 * an array - so the string segments are returned as-is.
 *
 * Callable directly as well as through `tNode`, because a caller that has
 * already split a multi-line string into its lines has a template but no longer
 * a key. The KPI info panel does exactly that: it renders each line as its own
 * paragraph or bullet, and any one of them may carry a live figure.
 */
export function interpolateNodes(
  template: string,
  params: Record<string, ReactNode>,
): ReactNode {
  return template.split(/(\{\w+\})/g).map((segment, i) => {
    const name = /^\{(\w+)\}$/.exec(segment)?.[1];
    if (name === undefined || !(name in params)) return segment;
    return <Fragment key={i}>{params[name]}</Fragment>;
  });
}

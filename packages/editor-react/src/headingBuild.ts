import { BUILD_PARAM_KEYS, buildSpecParams, type BuildSpec } from '@bendyline/squisq/schemas';
import {
  parsePandocAttrTokens,
  serializePandocAttributes,
  tokenizeAttrTokens,
  splitKeyValueToken,
  quoteAttrValue,
} from '@bendyline/squisq/markdown';

function params(inner: string | null): Record<string, string> {
  return Object.fromEntries(
    tokenizeAttrTokens(inner ?? '').flatMap((token) => {
      const part = splitKeyValueToken(token);
      return part ? [[part.key, part.value]] : [];
    }),
  );
}

export function readHeadingBuild(
  blockAttrs: string | null,
  templateParams: string | null,
): BuildSpec | undefined {
  return parsePandocAttrTokens(
    Object.entries({ ...params(templateParams), ...params(blockAttrs) })
      .map(([key, value]) => `${key}=${quoteAttrValue(value)}`)
      .join(' '),
  ).blockMeta?.build;
}

/** Rewrite the whole family atomically; remove legacy Pandoc duplicates. */
export function setHeadingBuild(
  blockAttrs: string | null,
  templateParams: string | null,
  build?: BuildSpec,
) {
  const attrs = parsePandocAttrTokens(blockAttrs ?? '');
  const template = params(templateParams);
  for (const key of BUILD_PARAM_KEYS) {
    if (attrs.params) delete attrs.params[key];
    if (attrs.metadata) delete attrs.metadata[key];
    delete template[key];
  }
  if (attrs.blockMeta) delete attrs.blockMeta.build;
  if (build) Object.assign(template, buildSpecParams(build));
  const pandoc = serializePandocAttributes(attrs);
  return {
    blockAttrsInner: pandoc && pandoc !== '{}' ? pandoc.slice(1, -1) : null,
    templateParams:
      Object.entries(template)
        .map(([key, value]) => `${key}=${quoteAttrValue(value)}`)
        .join(' ') || null,
  };
}

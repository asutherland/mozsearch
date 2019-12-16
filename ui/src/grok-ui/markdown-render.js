import unified from 'unified';
import markdown from 'remark-parse';
import remark2rehype from 'remark-rehype';
import raw from 'rehype-raw';
//import sanitize from 'rehype-sanitize';
import toDOM from 'hast-util-to-dom';

import visit from 'unist-util-visit';

// toDOM isn't a compiler on its own, so we need this minimal helper in order to
// make the `process` happy.
function compileToDOM() {
  function compiler(node) {
    return toDOM(node, { fragment: true });
  }

  this.Compiler = compiler;
}

const RE_ID_KEEP = /^([^()]+)\(.*\)$/;
/**
 * Just strip any parentheses off the end, including anything inside them.
 */
function normalizeId(srcId) {
  // The regexp only wants to match things with parentheses so we can eat
  // them.  Otherwise we want to pass-through.
  const match = RE_ID_KEEP.exec(srcId);
  if (match) {
    return match[1];
  }
  return srcId;
}

/**
 * Async transformer that visits all "code" blocks with a language of
 * "searchfox-graph-v1" and renders them into SVG.  These graphs are intended
 * to be be interactive via data-symbols only.  Interactive graph refinement
 * is something that will happen in the future by having an overlay icon that
 * will replicate the current graph's underlying model into the normal
 * editing/traversal UI's.
 *
 * For now, the expected representation of the graph is a JSON dictionary with
 * keys and meanings.  All of this is expected to change/expand.
 * - mode: One of the following strings identifying which "doodler" to use.
 *   - "protocol": Attempt to diagram the classes involved with a particular
 *     IPDL protocol or its specific methods.
 * - symbols: An array of strings where each string is a searchfox symbol.
 *   Except for our JS symbols, these are usually not particularly human
 *   readable, consisting of mangled C++ symbols, etc.
 * - identifiers: An array of strings where each string is a human-readable
 *   searchfox identifier.  These are mapped to symbols and treated like they
 *   had been provided in the "symbols" list.  Because symbols may change with
 *   changes to method arguments and identifiers do not, identifiers are usually
 *   a better choice.
 */
function renderGraphsInCodeBlocks({ grokCtx }) {
  const kb = grokCtx.kb;

  return function transformer(ast, vFile, next) {
    const promises = [];
    visit(ast, 'code', (node) => {
      if (node.lang !== 'searchfox-graph-v1') {
        return node;
      }

      //console.log('got graph JSON of', node.value);
      const gdef = JSON.parse(node.value);

      const svgPromise = kb.renderSVGDiagramFromGraphDef(gdef);

      promises.push(svgPromise.then(
        (svgStr) => {
          node.type = 'html';
          node.value = svgStr;
        },
        (err) => {
          node.value = 'Graph failed to render: ' + err;
        }));

      return node;
    });

    Promise.all(promises).then(
      () => {
        // All the ndoes have been fixed up now, hackily.  Hooray!
        next(null, ast, vFile);
      },
      (rejections) => {
        console.warn('rejections while processing graph', rejections);
        next(null, ast, vFile);
      });
  };
}

/**
 * Async transformer that visits all "inlineCode" uses that seem like they could
 * be valid searchfox identifiers, does a search to see if they are, and then
 * re-writes them so that when rendered into HTML they have "data-symbols" on
 * them.
 *
 * The strategy is this:
 * 1. Visit all the nodes, accumulating the candidate list of inlineCode nodes
 *    and building a de-duplicated list of the actual id's to look for.  (We
 *    expect with high probability that strings will recur.)
 * 2. Issue ID lookup requests in parallel for the de-duplicated identifiers.
 * 3. Wait for all the results to come in.
 * 4. Re-write nodes for which we got a result.  Leave the rest intact.
 */
function markIdentifiersInInlineCode({ grokCtx }) {
  const kb = grokCtx.kb;

  return function transformer(ast, vFile, next) {
    const eligibleNodes = [];
    const lookups = new Map();
    const promises = [];
    visit(ast, 'inlineCode', (node) => {
      if (node.value.includes(' ')) {
        // any whitespace disqualifies it.
        return node;
      }

      eligibleNodes.push(node);

      // keep going if we're already looking up this value.
      const useId = normalizeId(node.value);
      if (lookups.has(useId)) {
        return node;
      }

      lookups.set(useId, undefined);
      const p = kb.findSymbolsGivenId(useId);
      promises.push(p.then(
        (symbolSet) => {
          lookups.set(useId, symbolSet);
        },
        () => {
          lookups.set(useId, null);
        }));

      return node;
    });

    Promise.all(promises).then(
      () => {
        for (const node of eligibleNodes) {
          const useId = normalizeId(node.value);
          const symbolSet = lookups.get(useId);
          // Skip nodes that didn't resolve to symbols.
          if (!symbolSet) {
            continue;
          }

          const symbolNames =
            Array.from(symbolSet).map((sym) => sym.rawName).join(',');

          // Annotate the node with embedded hast data.
          node.data = {
            hProperties: {
              className: ['syn_def'],
              'data-symbols': symbolNames
            },
          };
        }
        next(null, ast, vFile);
      },
      (rejections) => {
        console.warn('rejections while processing markdown', rejections);
        next(null, ast, vFile);
      });
  };
}

export async function markdownRenderFromStr(markdownStr, grokCtx) {
  const domNodes = await unified()
  .use(markdown)
  .use(markIdentifiersInInlineCode, { grokCtx })
  .use(renderGraphsInCodeBlocks, { grokCtx })
  // We need to enable allowDangerousHTML in order to get the "html" blocks
  // produced by `renderGraphsInCodeBlocks` passed-through.  We should look
  // into using embedded hast data like hChildren, but that either requires a
  // raw node or full conversion to a hast-tree directly, etc.  So we just do
  // this for now.
  .use(remark2rehype, { allowDangerousHTML: true })
  // TODO: determine to what extent this makes sense, it's already the case that
  // the source tree lives inside a trust boundary.  If we enable this,
  // data-symbols needs to be allowed, plus the class.
  //.use(sanitize)
  // And we need this enabled to actually convert the raw HTML into HTML.
  .use(raw)
  .use(compileToDOM)
  .process(markdownStr);

  // It's wrapped?
  return domNodes.contents;
}

/**
 * Given a searchfox #file node, extract the raw markdown source from the DOM.
 * There's not a ton of intent to this.  Perhaps we should just be fetching the
 * raw backing file?
 */
export function markdownRenderFromDOM(fileNode, grokCtx) {
  const strLines = [];

  const nodeLines = fileNode.querySelectorAll('code.source-line');
  for (const node of nodeLines) {
    strLines.push(node.textContent);
  }

  // There are already newlines built in!
  const str = strLines.join('');

  return markdownRenderFromStr(str, grokCtx);
}

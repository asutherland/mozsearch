import unified from 'unified';
import markdown from 'remark-parse';
import remark2rehype from 'remark-rehype';
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
        console.warn('rejections while processing markdwon', rejections);
        next(null, ast, vFile);
      });
  };
}

export async function markdownRenderFromStr(markdownStr, grokCtx) {
  const domNodes = await unified()
  .use(markdown)
  .use(markIdentifiersInInlineCode, { grokCtx })
  .use(remark2rehype)
  // TODO: determine to what extent this makes sense, it's already the case that
  // the source tree lives inside a trust boundary.  If we enable this,
  // data-symbols needs to be allowed, plus the class.
  //.use(sanitize)
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

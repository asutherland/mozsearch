import unified from 'unified';
import markdown from 'remark-parse';
import remark2rehype from 'remark-rehype';
import sanitize from 'rehype-sanitize';
import toDOM from 'hast-util-to-dom';

// toDOM isn't a compiler on its own, so we need this minimal helper in order to
// make the `process` happy.
function compileToDOM() {
  function compiler(node) {
    return toDOM(node, { fragment: true });
  }

  this.Compiler = compiler;
}

export async function markdownRenderFromStr(markdownStr) {
  const domNodes = await unified()
  .use(markdown)
  .use(remark2rehype)
  .use(sanitize)
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
export function markdownRenderFromDOM(fileNode) {
  const strLines = [];

  const nodeLines = fileNode.querySelectorAll('code.source-line');
  for (const node of nodeLines) {
    strLines.push(node.textContent);
  }

  // There are already newlines built in!
  const str = strLines.join('');

  return markdownRenderFromStr(str);
}

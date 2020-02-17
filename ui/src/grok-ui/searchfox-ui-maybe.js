/**
 * This file is a mechanism to only load searchfox-ui.js and all of its many
 * large dependencies if we are not in an iframe.  This is done because the
 * top-level context will load source code pages via iframes and there's no
 * point slowing things down with pointless JS execution in those frames.
 *
 * Because we initiate the import synchronously during our execution, this will
 * delay the page's "load" event, which means that searchfox-ui.js's "load"
 * listener will still get a chance to fire.
 **/
if (window.parent === window) {
  import(/* webpackChunkName: "actual-searchfox-ui" */ './searchfox-ui.js');
}

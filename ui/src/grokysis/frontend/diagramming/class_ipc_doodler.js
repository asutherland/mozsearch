/**
 * Async doodler that, given a class as a starting point, attempts to figure out
 * related classes, their IPC counterparts, and how they are situated in
 * Firefox's process/threading model.  This is expected to evolve over time and
 * drive the creation of various client-side heuristic analyses which eventually
 * make their way closer to the indexing "metal".
 *
 * The diagram hierarchy is expected to be, nested from outer to inner:
 * - Process: Parent / Content / Network / Whatever
 * - Thread: Main / Worker / Client (Main or Worker) / PBackground / etc.
 * - Ownership: Window or Worker Client / Origin / Per-Thread
 * - Actual Classes
 *
 * To start, a simplified Process: Parent/Content and Thread: Main / Worker /
 * Client / PBackground / Other will probably be it for hierarchy.  I will also
 * be hard-coding various class hints and other things in that would later come
 * from somewhere else like doxygen markup or TOML files or something.
 *
 * ## Implementation Overview
 * This section is to be re-written once other aspects have been implemented.
 *
 * Introduce the following new more complex analyses:
 * - Create a 'class-interaction' analysis that:
 *   -
 *
 */
export default class ClassIPCDoodler {
  async doodleCalls(grokCtx, rootSym, diagram) {

    console.log('Diagram doodling completed.');
  }
}

/**
 * Given a SymbolInfo that's been analyzed, build a graph of its superclasses
 * and subclasses.  For now, no attempt is made to include indirectly related
 * classes (ex: cousins).
 *
 */
export default class HierarchyDoodler {
  doodleHierarchy(rootSym, diagram) {
    diagram.settingOverrides = {
      layoutDir: 'BT',
    };

    const recurseSupers = (symInfo) => {
      if (!symInfo.supers) {
        return;
      }
      for (const superMeta of symInfo.supers) {
        const superSym = superMeta.symInfo;
        if (superSym) {
          diagram.ensureEdge(symInfo, superSym);
          recurseSupers(superSym);
        }
      }
    };

    const recurseSubclasses = (symInfo) => {
      if (!symInfo.subclasses) {
        return;
      }
      for (const subMeta of symInfo.subclasses) {
        const subSym = subMeta.symInfo;
        if (subSym) {
          diagram.ensureEdge(subSym, symInfo);
          recurseSubclasses(subSym);
        }
      }
    };

    diagram.beginBatch();
    recurseSupers(rootSym);
    recurseSubclasses(rootSym);
    diagram.endBatch();
  }
}

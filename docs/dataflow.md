# Mozsearch Experimental Symbolic Dataflow Magic

## Purpose / Limitations

All current dataflow support is in support of 2 goals at this time:

1. Providing the ability to follow a value either forward through the system or
   backwards through the system while leveraging understanding of symbolic
   constraints.  For example, if we assume a principal is a content principal,
   mozsearch should be able to skip over any system-principal-specific logic.
2. Improve automatic diagrams by being able to understand classes as orthogonal
   slices of functionality based on the dataflow-aware field access patterns and
   how different types flow through the class.

Although we build on existing static analysis tools like the the Clang Static
Analyzer, this functionality is not intended to replace existing static analysis
tooling.  In particular, if your question is if this can replace writing a
checker for the Clang Static Analyzer or using the Clang Dataflow Analysis
Framework, then the answer is a hard no.

## Data Representation

### What the Clang Static Analyzer (CSA) gives us

The CSA is fairly complex, so this section might not make much sense without
additional context that is beyond the scope of this document / my ability to
describe it.  It's worth checking out the resources linked in
https://discourse.llvm.org/t/advice-on-how-to-approach-a-checker/71334 and in
particular the 2012 presentation, the clang analyzer guide, and the paper on
the memory model of the CSA referenced at the end of the analyzer guide.

The CSA performs symbolic execution at a translation unit granularity.  There
are ways to run it in a cross-translation-unit mode (CTU) and the CodeChecker
tool in particular is the canonical supported way of doing that.  We do not
currently use the CTU mode, although the gecko unified builds system does have
a side-effect in terms of expanding the scope that CSA is able to analyze in a
rather arbitrary and unstable fashion.

The CSA operates on the Clang AST rather than LLVM IR which means that we have
ready access to all the information our indexer normally has access to, but that
neither we nor the CSA are really able to take advantage of the Static Single
Assignment (SSA) rep or the optimization passes.  (In the future we may be able
to leverage VAST, ClangIR, and the MLIR.)

The CSA provides us with an "exploded graph" which is a graph of each analyzed
function and all of the function calls the CSA was able/chose to inline.  Each
node represents a program "point" and the state at that point with edges
corresponding to transitions between those states resulting from the symbolic
execution.  Multiple edges will occur when there are multiple possible
assumptions that can be made; for example, at an if conditional on a boolean,
symbolic execution will assume both the boolean being true and being false if
there are no existing constraints on the boolean.  Other checkers run at the
same time fundamentally impact this process which does mean that if we add
custom checkers, we can potentially help the CSA help us.

This graph is explicitly not a graph of the Control Flow Graph (CFG) of the
function that tells us the possible states at all location in the function.  We
might instead visualize the graph as a description of the path of (tape)
playback heads moving over such a graph.  The task of our CSA checker plugin is
then to project the exploded graph back onto the source listing in a way that
our mozsearch logic can follow values in a forward or backward direction,
applying and/or propagating constraints as it geos so that we can effectively
reproduce the symbolic execution at runtime.

The exploded graph is provided to us by the `checkEndAnalysis` callback which is
fired when a (non-inlined) function is being done being analyzed, and that could
also include processing of inlined function executions.  If a function isn't
available within the translation unit, behavior cannot be predicted.

There are a number of other callbacks that checkers can register for which let
the checkers participate in the symbolic execution.  For example, taint can be
added to symbols and then the infrastructure will help propagate the taint.
While it could make sense for mozsearch to participate in the symbolic execution
process to contribute tainting, we don't register callbacks for the purposes of
mapping data onto the source code.  This is because symbolic execution is
speculative and it's possible callbacks may be invoked for program states that
end up being subsequently being marked as impossible.  Additionally, the
additional states have non-trivial resource impacts, so if we're not
contributing data that benefits from the symbolic execution's machinery, it's
better for us to wait until the end of the analysis.

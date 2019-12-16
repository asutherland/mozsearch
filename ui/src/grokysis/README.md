# Searchfox Code Understanding Core Logic

This directory is intended to be core searchfox semantic logic that's broken
into a frontend that lives in the page and a backend that lives in a worker.

Because the initial prototype depended heavily on HTML scraping, the analysis
logic started out its life already in the front-end.  For pragmatism, other
logic also ended up in the frontend that could potentially be CPU intensive.
(Specifically, graph analysis stuff.)

It's future work to figure out how to split things in a useful way.  Right now
all the frontend/backend split really accomplishes is making sure certain
inherently-structured-clone-safe structures are structured-clone-safe.  (Yes,
that's pointless.  If more things had lived in the fake backend, then it would
have been less pointless and helped avoid situations that made actual worker use
hard/impossible.)

That said, once possible sketch would be:
- Have the Worker be where all of the knowledge base "analysis" steps occur,
  posessing a superset of the symbol info known in the page.
- All graph algorithms run in the Worker.
- SymbolInfo instances are only shipped over from the worker on an as-needed
  basis.  The `analyzed`/`analyzing` booleans take on differing meanings based
  on the context.  In the Worker, it means whether or not we've asked the
  server for info.  In the page, it means whether or not we've asked the worker
  for info.
- We could consider a SharedWorker, but it might make sense to wait until we
  optimize MessagePort for the same-process situation.

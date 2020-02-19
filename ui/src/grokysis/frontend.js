import makeBackend from './backend.js';

import SessionManager from './frontend/session_manager.js';

import RawSearchResults from './frontend/raw_search_results.js';
import FilteredResults from './frontend/filtered_results.js';
import KnowledgeBase from './frontend/knowledge_base.js';

import Viz from 'viz.js';
import workerURL from 'viz.js/full.render.js';

class GrokAnalysisFrontend {
  /**
   * The frontend name determines the root IndexedDB database name used.
   * Per-session databases are created that are prefixed with this name.  You
   * probably want to pick a single app-specific name and hardcode it.
   */
  constructor({ session }) {
    this.treeName = session.treeName;

    this.sessionManager = new SessionManager(
      session, this,
      (diskRep) => {
        return this._sendAndAwaitReply('persistSessionThing', diskRep);
      },
      (thingId) => {
        return this._sendAndAwaitReply('deleteSessionThingById', thingId);
      });

    this.kb = new KnowledgeBase({
      treeName: this.treeName,
      grokCtx: this,
      iframeParentElem: session.iframeParentElem,
    });

    /**
     * This currently gets clobbered in by `searchfox-ui.js` but probably would
     * do better to be instantiated here or via caller-provided helper func.
     */
    this.historyHelper = null;

    const { backend, useAsPort } = makeBackend();
    this._backend = backend; // the direct destructuring syntax is confusing.
    this._port = useAsPort;
    this._port.addEventListener("message", this._onMessage.bind(this));
    this._port.start();

    this._awaitingReplies = new Map();
    this._nextMsgId = 1;

    this._vizJs = null;

    this._sendAndAwaitReply(
      "init",
      {
        treeName: this.treeName
      }).then((initData) => {
        this._initCompleted(initData);
      });
  }

  get vizJs() {
    if (this._vizJs) {
      return this._vizJs;
    }

    this._vizJs = new Viz({ workerURL });
    return this._vizJs;
  }

  _onMessage(evt) {
    const data = evt.data;
    const { type, msgId, payload } = data;

    // -- Replies
    if (type === "reply") {
      if (!this._awaitingReplies.has(msgId)) {
        console.warn("Got reply without map entry:", data, "ignoring.");
        return;
      }
      if (window.DEBUG_GROKYSIS_BRIDGE) {
        console.log("reply", msgId, type, payload);
      }
      const { resolve, reject } = this._awaitingReplies.get(msgId);
      if (data.success) {
        resolve(payload);
      } else {
        reject(payload);
      }
      return;
    }

    // -- Everything else, none of which can be expecting a reply.
    const handlerName = "msg_" + type;
    try {
      this[handlerName](payload);
    } catch(ex) {
      console.error(`Problem processing message of type ${type}:`, data, ex);
    }
  }

  _sendNoReply(type, payload) {
    this._port.postMessage({
      type,
      msgId: 0,
      payload
    });
  }

  _sendAndAwaitReply(type, payload) {
    const msgId = this._nextMsgId++;
    if (window.DEBUG_GROKYSIS_BRIDGE) {
      console.log("request", msgId, type, payload);
    }
    this._port.postMessage({
      type,
      msgId,
      payload
    });

    return new Promise((resolve, reject) => {
      this._awaitingReplies.set(msgId, { resolve, reject });
    });
  }


  _initCompleted({ /*globals,*/ sessionThings }) {
    this.sessionManager.consumeSessionData(sessionThings);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Searchfox / grokysis stuff

  /**
   * Perform a search, immediately returning a FilteredResults instance that
   * will dirty itself once results have been received.
   */
  performSyncSearch(searchStr) {
    const filtered = new FilteredResults({ rawResultsList: [] });
    this._performAsyncSearch(searchStr, filtered);
    return filtered;
  }

  ingestExistingSearchResults(rawSearchResults) {
    const filtered = new FilteredResults({
      rawResultsList: [rawSearchResults],
    });
    return filtered;
  }

  async performAsyncSearch(searchStr) {
    const filtered = new FilteredResults({ rawResultsList: [] });
    await this._performAsyncSearch(searchStr, filtered);
    return filtered;
  }

  async _performAsyncSearch(searchStr, filtered) {
    const wireResults = await this._sendAndAwaitReply(
      "search",
      {
        searchStr
      });
    const rawResults = new RawSearchResults(wireResults);
    filtered.addRawResults(rawResults);
  }

  /**
   * Fetch a raw-analysis file, returning its NDJSON payload as an array of
   * objects.
   */
  async fetchFile(fetchArgs) {
    const wireResults = await this._sendAndAwaitReply(
      "fetchFile",
      fetchArgs
    );
    return wireResults;
  }

  /**
   * Fetch all the exposed per-tree info.  Right now this means:
   * - repoFiles: Set of all known source-tree paths.
   * - objdirFiles: Set of all known __GENERATED__ paths.
   *
   * It currently intentionally does not include a mapping for:
   * - bugzilla-components.json: This file is 9.1M in mozilla-central.  That's
   *   too much.  It probably makes sense to aggregate and expose our per-file
   *   info.  (Right now that would be the bugzilla component and the extracted
   *   file summary, mainly?)
   */
  async fetchTreeInfo() {
    const wireResults = await this._sendAndAwaitReply(
      "fetchTreeInfo",
      {}
    );

    return {
      repoFiles: new Set(wireResults.repoFilesList),
      objdirFiles: new Set(wireResults.objdirFilesList),
    };
  }
}

export default GrokAnalysisFrontend;

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Sources reducer
 * @module reducers/sources
 */

import { prefs } from "../utils/prefs";

export function initialSourcesState(state) {
  return {
    /**
     * All currently available sources.
     *
     * See create.js: `createSourceObject` method for the description of stored objects.
     */
    sources: new Map(),

    /**
     * All sources associated with a given URL. When using source maps, multiple
     * sources can have the same URL.
     *
     * Dictionary(url => array<source id>)
     */
    urls: {},

    /**
     * List of all source ids whose source has a url attribute defined
     *
     * Array<source id>
     */
    sourcesWithUrls: [],

    /**
     * Mapping of source id's to one or more source-actor id's.
     * Dictionary whose keys are source id's and values are arrays
     * made of all the related source-actor id's.
     *
     * "source" are the objects stored in this reducer, in the `sources` attribute.
     * "source-actor" are the objects stored in the "source-actors.js" reducer, in its `sourceActors` attribute.
     *
     * Dictionary(source id => array<SourceActor ID>)
     */
    actors: {},

    breakpointPositions: {},
    breakableLines: {},

    /**
     * The actual currently selected location.
     * Only set if the related source is already registered in the sources reducer.
     * Otherwise, pendingSelectedLocation should be used. Typically for sources
     * which are about to be created.
     *
     * It also includes line and column information.
     *
     * See `createLocation` for the definition of this object.
     */
    selectedLocation: undefined,

    /**
     * When we want to select a source that isn't available yet, use this.
     * The location object should have a url attribute instead of a sourceId.
     */
    pendingSelectedLocation: prefs.pendingSelectedLocation,

    /**
     * Project root set from the Source Tree.
     *
     * This focused the source tree on a subset of sources.
     */
    projectDirectoryRoot: prefs.projectDirectoryRoot,
    projectDirectoryRootName: prefs.projectDirectoryRootName,

    /**
     * Boolean, to be set to true in order to display WebExtension's content scripts
     * that are applied to the current page we are debugging.
     *
     * Covered by: browser_dbg-content-script-sources.js
     * Bound to: devtools.chrome.enabled
     *
     * boolean
     */
    chromeAndExtensionsEnabled: prefs.chromeAndExtensionsEnabled,
  };
}

function update(state = initialSourcesState(), action) {
  let location = null;

  switch (action.type) {
    case "ADD_SOURCES":
      return addSources(state, action.sources);

    case "INSERT_SOURCE_ACTORS":
      return insertSourceActors(state, action);

    case "SET_SELECTED_LOCATION":
      location = {
        ...action.location,
        url: action.source.url,
      };

      if (action.source.url) {
        prefs.pendingSelectedLocation = location;
      }

      return {
        ...state,
        selectedLocation: {
          sourceId: action.source.id,
          ...action.location,
        },
        pendingSelectedLocation: location,
      };

    case "CLEAR_SELECTED_LOCATION":
      location = { url: "" };
      prefs.pendingSelectedLocation = location;

      return {
        ...state,
        selectedLocation: null,
        pendingSelectedLocation: location,
      };

    case "SET_PENDING_SELECTED_LOCATION":
      location = {
        url: action.url,
        line: action.line,
        column: action.column,
      };

      prefs.pendingSelectedLocation = location;
      return { ...state, pendingSelectedLocation: location };

    case "SET_PROJECT_DIRECTORY_ROOT":
      const { url, name } = action;
      return updateProjectDirectoryRoot(state, url, name);

    case "SET_ORIGINAL_BREAKABLE_LINES": {
      const { breakableLines, sourceId } = action;
      return {
        ...state,
        breakableLines: {
          ...state.breakableLines,
          [sourceId]: breakableLines,
        },
      };
    }

    case "ADD_BREAKPOINT_POSITIONS": {
      const { source, positions } = action;
      const breakpointPositions = state.breakpointPositions[source.id];

      return {
        ...state,
        breakpointPositions: {
          ...state.breakpointPositions,
          [source.id]: { ...breakpointPositions, ...positions },
        },
      };
    }

    case "NAVIGATE":
      return initialSourcesState(state);

    case "REMOVE_THREAD": {
      const threadSources = [];
      for (const source of state.sources.values()) {
        if (source.thread == action.threadActorID) {
          threadSources.push(source);
        }
      }
      return removeSourcesAndActors(state, threadSources);
    }
  }

  return state;
}

/*
 * Add sources to the sources store
 * - Add the source to the sources store
 * - Add the source URL to the urls map
 */
function addSources(state, sources) {
  const originalState = state;

  state = {
    ...state,
    urls: { ...state.urls },
  };

  const newSourceMap = new Map(state.sources);
  for (const source of sources) {
    newSourceMap.set(source.id, source);

    // 1. Update the source url map
    const existing = state.urls[source.url] || [];
    if (!existing.includes(source.id)) {
      state.urls[source.url] = [...existing, source.id];
    }

    // 2. Update the sourcesWithUrls map
    if (source.url) {
      // NOTE: we only want to copy the list once
      if (originalState.sourcesWithUrls === state.sourcesWithUrls) {
        state.sourcesWithUrls = [...state.sourcesWithUrls];
      }

      state.sourcesWithUrls.push(source.id);
    }
  }
  state.sources = newSourceMap;

  return state;
}

function removeSourcesAndActors(state, sources) {
  state = {
    ...state,
    urls: { ...state.urls },
  };

  const newSourceMap = new Map(state.sources);
  for (const source of sources) {
    newSourceMap.delete(source.id);

    if (source.url) {
      // urls
      if (state.urls[source.url]) {
        state.urls[source.url] = state.urls[source.url].filter(
          id => id !== source.id
        );
      }
      if (state.urls[source.url]?.length == 0) {
        delete state.urls[source.url];
      }

      // sourcesWithUrls
      state.sourcesWithUrls = state.sourcesWithUrls.filter(
        sourceId => sourceId !== source.id
      );
    }
    // actors
    delete state.actors[source.id];
  }
  state.sources = newSourceMap;
  return state;
}

function insertSourceActors(state, action) {
  const { items } = action;
  state = {
    ...state,
    actors: { ...state.actors },
  };

  // The `sourceActor` objects are defined from `newGeneratedSources` action:
  // https://searchfox.org/mozilla-central/rev/4646b826a25d3825cf209db890862b45fa09ffc3/devtools/client/debugger/src/actions/sources/newSources.js#300-314
  for (const sourceActor of items) {
    state.actors[sourceActor.source] = [
      ...(state.actors[sourceActor.source] || []),
      sourceActor.id,
    ];
  }

  const scriptActors = items.filter(
    item => item.introductionType === "scriptElement"
  );
  if (scriptActors.length > 0) {
    const { ...breakpointPositions } = state.breakpointPositions;

    // If new HTML sources are being added, we need to clear the breakpoint
    // positions since the new source is a <script> with new breakpoints.
    for (const { source } of scriptActors) {
      delete breakpointPositions[source];
    }

    state = { ...state, breakpointPositions };
  }

  return state;
}

/*
 * Update sources when the project directory root changes
 */
function updateProjectDirectoryRoot(state, root, name) {
  // Only update prefs when projectDirectoryRoot isn't a thread actor,
  // because when debugger is reopened, thread actor will change. See bug 1596323.
  if (actorType(root) !== "thread") {
    prefs.projectDirectoryRoot = root;
    prefs.projectDirectoryRootName = name;
  }

  state = {
    ...state,
    projectDirectoryRoot: root,
    projectDirectoryRootName: name,
  };

  return state;
}

/* Checks if a path is a thread actor or not
 * e.g returns 'thread' for "server0.conn1.child1/workerTarget42/thread1"
 */
function actorType(actor) {
  const match = actor.match(/\/([a-z]+)\d+/);
  return match ? match[1] : null;
}

export default update;

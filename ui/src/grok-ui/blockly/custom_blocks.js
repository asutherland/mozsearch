/**
 * Contains our custom block definitions as initially created via:
 * https://blockly-demo.appspot.com/static/demos/blockfactory/index.html
 *
 * Our blocks are processed to a HierNode representation via
 * `custom_generator.js`, noting that it's not strictly a code generator like
 * the normal blockly ones.  But from a terminology perspective, calling it a
 * generator makes sense.
 *
 * We currently attempt to abuse the variables mechanism to simplify edge
 * generation.  Everything that an edge can be drawn to is named via variable
 * where its name is an identifier.  This provides dynamically updating
 * dropdowns so that edges can be more easily defined.  It's quite possible this
 * may want to evolve.
 */

import Blockly from 'blockly/core';

const cluster_process_def = {
  "type": "cluster_process",
  "message0": "Process %1 %2 %3",
  "args0": [
    {
      "type": "field_input",
      "name": "NAME",
      "text": "Parent"
    },
    {
      "type": "input_dummy"
    },
    {
      "type": "input_statement",
      "name": "CHILDREN",
      "check": "graphy"
    }
  ],
  "previousStatement": "graphy",
  "nextStatement": "graphy",
  "colour": 0,
  "tooltip": "",
  "helpUrl": ""
};
Blockly.Blocks['cluster_process'] = {
  init() {
    this.jsonInit(cluster_process_def);
  }
};

const cluster_thread_def = {
  "type": "cluster_thread",
  "message0": "Thread %1 %2 %3",
  "args0": [
    {
      "type": "field_input",
      "name": "NAME",
      "text": "Main"
    },
    {
      "type": "input_dummy"
    },
    {
      "type": "input_statement",
      "name": "CHILDREN",
      "check": "graphy"
    }
  ],
  "previousStatement": "graphy",
  "nextStatement": "graphy",
  "colour": 105,
  "tooltip": "",
  "helpUrl": ""
};
Blockly.Blocks['cluster_thread'] = {
  init() {
    this.jsonInit(cluster_thread_def);
  }
};

const node_class_def = {
  "type": "node_class",
  "message0": "Class %1 %2 %3",
  "args0": [
    {
      "type": "field_variable",
      "name": "NAME",
      "variable": null
    },
    {
      "type": "input_dummy"
    },
    {
      "type": "input_statement",
      "name": "METHODS",
      "check": "methorcall"
    }
  ],
  "previousStatement": "graphy",
  "nextStatement": "graphy",
  "colour": 230,
  "tooltip": "",
  "helpUrl": ""
};
Blockly.Blocks['node_class'] = {
  init() {
    this.jsonInit(node_class_def);
  }
};

const edge_call_def = {
  "type": "edge_call",
  "message0": "Calls %1",
  "args0": [
    {
      "type": "field_variable",
      "name": "CALLS_WHAT",
      "variable": null
    }
  ],
  "previousStatement": "methorcall",
  "nextStatement": "methorcall",
  "colour": 285,
  "tooltip": "",
  "helpUrl": ""
};
Blockly.Blocks['edge_call'] = {
  init() {
    this.jsonInit(edge_call_def);
  }
};

const node_method_def = {
  "type": "node_method",
  "message0": "Method %1 %2 %3",
  "args0": [
    {
      "type": "field_variable",
      "name": "NAME",
      "variable": null
    },
    {
      "type": "input_dummy"
    },
    {
      "type": "input_statement",
      "name": "methorcall",
      "check": "methorcall"
    }
  ],
  "previousStatement": "methorcall",
  "nextStatement": "methorcall",
  "colour": 165,
  "tooltip": "",
  "helpUrl": ""
};
Blockly.Blocks['node_method'] = {
  init() {
    this.jsonInit(node_method_def);
  }
};

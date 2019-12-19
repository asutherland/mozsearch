import React from 'react';

import Blockly from 'blockly/core';
// Searchfox currently presumes an English locale
import locale from 'blockly/msg/en';
// we explicitly aren't importing blockly/blocks.  We use only custom
// block definitions and custom generators.  which we import here...
import '../../blockly/custom_blocks.js';

import './editor.css';


Blockly.setLocale(locale);

export default class BlocklyEditor extends React.Component {
  constructor(props) {
    super(props);

    this.primaryWorkspace = null;

    this.editorRef = React.createRef();
    this.toolboxRef = React.createRef();
  }

  componentDidMount() {
    const editorElem = this.editorRef.current;
    const toolboxElem = this.toolboxRef.current;

    const { initialXml, children, onChange, ...rest } = this.props;
    this.primaryWorkspace = Blockly.inject(
      editorElem,
      {
        toolbox: toolboxElem,
        ...rest
      },
    );

    if (initialXml) {
      Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(initialXml), this.primaryWorkspace);
    }

    this.primaryWorkspace.addChangeListener(this.onWorkspaceChange.bind(this));
  }

  onWorkspaceChange() {
    if (this.props.onChange) {
      const xml =
        Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(this.primaryWorkspace));
      this.props.onChange(this.primaryWorkspace, xml);
    }
  }

  updateSize() {
    Blockly.svgResize(this.primaryWorkspace);
  }

  get workspace() {
    return this.primaryWorkspace;
  }

  setXml(xml) {
    Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), this.primaryWorkspace);
  }

  render() {
    const { children } = this.props;

    return (
      <div className="blocklyEditor" >
        <div ref={ this.editorRef } className="blocklyEditor_inner"/>
        <xml
          xmlns="https://developers.google.com/blockly/xml"
          is="blockly"
          style={{ display: 'none' }}
          ref={ this.toolboxRef }
          >
          {children}
        </xml>
      </div>
    );
  }
}

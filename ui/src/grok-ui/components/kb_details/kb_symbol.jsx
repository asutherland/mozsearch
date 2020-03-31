/* eslint-disable react/jsx-key */
import React from 'react';

import { Button, List, Tab, Table } from 'semantic-ui-react';

import DirtyingComponent from '../dirtying_component.js';

import SymSource from './sym_source.jsx';

export default class KBSymbol extends DirtyingComponent {
  constructor(props) {
    super(props, 'symInfo');
  }

  onShowSymbolSheet(evt, symInfo) {
    this.props.sessionThing.addThingInOtherTrack({
      type: 'symbolView',
      persisted: {
        rawSymbol: symInfo.rawName,
        pretty: symInfo.pretty,
      },
    });
  }

  onShowSymbolPopup(evt, clickedSymInfo) {
    evt.stopPropagation();
    evt.preventDefault();

    this.props.sessionThing.showPopup(
        'symbolInfo',
        // we express ourselves as the from so that this can be used to create
        // a graph edge.
        { symInfo: clickedSymInfo, fromSymInfo: this.props.symInfo },
        // the popup wants to be relative to the clicked symbol.
        evt.target);
  }

  onAddContextEdge(evt, from, to) {
    evt.stopPropagation();
    evt.preventDefault();

    const thing = this.props.sessionThing;
    thing.sendSlotMessage('diagram', 'addEdge', { from, to });
  }

  onNavigateInto(evt, to) {
    evt.stopPropagation();
    evt.preventDefault();

    this.props.doNavigateIntoSym(to);
  }

  /**
   * In-flux helper to provide a single flattened list of fields amongst the
   * canonical SymbolInfo `fields` list plus its processed variants.  Merging is
   * somewhat straightforward because we're able to sort on the line numbers of
   * their definitions so we don't need to try some kind of diffing algorithm
   * cleverness.
   */
  _mergeFieldVariants(canonSymInfo) {
    const rows = [];

    const allSyms = [canonSymInfo, ...(canonSymInfo.variants || [])];
    let varCursors = allSyms.map((varSymInfo) => {
      return {
        platforms: varSymInfo.platforms,
        fields: varSymInfo.fields,
        idx: 0,
      };
    });

    // Walk the list of variant cursors, picking the earliest symbol we find,
    // line-number-wise, and accumulating all same-line symbols, then emitting
    // them in a row.
    const HIGH_LINE = 2000000;
    for (;;) {
      let earliestLine = HIGH_LINE;
      let matchingCursors = new Map();
      for (const cursor of varCursors) {
        if (cursor.idx >= cursor.fields.length) {
          continue;
        }
        const fieldInfo = cursor.fields[cursor.idx];
        // We might not have the defLocation if the symbol hasn't been fully
        // analyzed yet.  Just treat such symbols as having a 0 location for
        // now, but perhaps we should be waiting for the analysis bit to be
        // set before displaying info related to this at all?
        const fieldLine = fieldInfo.symInfo.defLocation ?
          fieldInfo.symInfo.defLocation.lno : 0;
        if (fieldLine < earliestLine) {
          earliestLine = fieldLine;
          matchingCursors.clear();
        }
        matchingCursors.set(cursor, fieldInfo);
      }

      if (matchingCursors.size === 0) {
        break;
      }

      for (const cursor of matchingCursors.keys()) {
        cursor.idx++;
      }

      rows.push(matchingCursors);
    }

      return { allSyms, varCursors, rows };
  }

  render() {
    const { symInfo } = this.props;

    const panes = [];

    // XXX since we no longer extract data from scraping the HTML, we no longer
    // actually have the source currently.
    let maybeSource;
    if (symInfo.sourceFragment) {
      maybeSource = (
        <SymSource
          symInfo={ symInfo }
          sessionThing={ this.props.sessionThing }
          />
      );
    }

    if (symInfo.fields && symInfo.fields.length) {
      panes.push({
        menuItem: 'Fields',
        render: () => {
          const { allSyms, varCursors, rows } = this._mergeFieldVariants(symInfo);

          const headerColumnsOne = [
            <Table.HeaderCell>Name</Table.HeaderCell>,
            <Table.HeaderCell>Type</Table.HeaderCell>,
            <Table.HeaderCell>Definition</Table.HeaderCell>
          ];
          const headerColumnsTwo = [
            <Table.HeaderCell></Table.HeaderCell>,
            <Table.HeaderCell></Table.HeaderCell>,
            <Table.HeaderCell></Table.HeaderCell>,
          ];
          for (const colSymInfo of allSyms) {
            headerColumnsOne.push(
              <Table.HeaderCell colSpan='2'>
                { colSymInfo.platforms.map(name => <div key={name}>{name}</div>) }
              </Table.HeaderCell>
            );
            headerColumnsTwo.push(
              <Table.HeaderCell>
                Offset
              </Table.HeaderCell>
            );
            headerColumnsTwo.push(
              <Table.HeaderCell>
                Size
              </Table.HeaderCell>
            );
          }

          const tableRows = rows.map((cursorMap) => {
            const columns = [];

            const firstField = cursorMap.values().next().value;
            const fieldSymInfo = firstField.symInfo;
            const fieldTypeSymInfo = firstField.typeSymInfo;
            columns.push(
              <Table.Cell>
                <code
                  data-symbols={ fieldSymInfo.rawName }
                  >
                  { fieldSymInfo.localName || fieldSymInfo.prettiestName }
                </code>
              </Table.Cell>
            );
            columns.push(
              <Table.Cell>
                <code
                  data-symbols={ fieldTypeSymInfo && fieldTypeSymInfo.rawName }
                  >
                  { firstField.type }
                </code>
              </Table.Cell>
            );
            columns.push(
              <Table.Cell>
                <code className="source-block">{ fieldSymInfo.defPeek }</code>
              </Table.Cell>
            );

            for (const cursorInfo of varCursors) {
              const fieldInfo = cursorMap.get(cursorInfo);
              if (fieldInfo) {
                columns.push(
                  <Table.Cell>
                    { fieldInfo.offsetBytes }
                  </Table.Cell>
                );
                columns.push(
                  <Table.Cell>
                    { fieldInfo.sizeBytes }
                  </Table.Cell>
                );
              } else {
                columns.push(
                  <Table.Cell></Table.Cell>
                );
                columns.push(
                  <Table.Cell></Table.Cell>
                );
              }
            }
            return (
              <Table.Row>
                { columns }
              </Table.Row>
            );
          });

          return (
            <Tab.Pane>
              <Table celled>
                <Table.Header>
                  <Table.Row>
                    { headerColumnsOne }
                  </Table.Row>
                  <Table.Row>
                    { headerColumnsTwo }
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                { tableRows }
                </Table.Body>
              </Table>
            </Tab.Pane>
          );
        }
      });
    }

    panes.push({
      menuItem: 'Info',
      render: () => {
        return (
          <Tab.Pane>
            <div>{ symInfo.syntaxKind }</div>
            { maybeSource }
          </Tab.Pane>
        );
      }
    });
    panes.push({
      menuItem: 'Calls',
      render: () => {
        symInfo.ensureCallEdges();
        const symItems = [];
        for (const callSym of symInfo.callsOutTo) {
          symItems.push(
            <List.Item
              key={ callSym.rawName }
              >
              <Button.Group size='mini' compact={true} >
                <Button icon='pencil'
                  onClick={ (evt) => { this.onAddContextEdge(evt, symInfo, callSym); }}/>
                <Button icon='eye'
                  onClick={ (evt) => { this.onNavigateInto(evt, callSym); }}/>
                <Button icon='sticky note outline'
                  onClick={ (evt) => { this.onShowSymbolSheet(evt, callSym); }}/>
              </Button.Group>
              &nbsp;<a onClick={ (evt) => { this.onShowSymbolPopup(evt, callSym); }}>{ callSym.prettiestName }</a>
            </List.Item>
          );
        }

        return (
          <Tab.Pane>
            { symItems }
          </Tab.Pane>
        );
      }
    });
    panes.push({
      menuItem: 'Callers',
      render: () => {
        symInfo.ensureCallEdges();
        const symItems = [];
        for (const callSym of symInfo.receivesCallsFrom) {
          symItems.push(
            <List.Item
              key={ callSym.rawName }
              >
              <Button.Group size='mini' compact={ true } >
                <Button icon='pencil'
                  onClick={ (evt) => { this.onAddContextEdge(evt, callSym, symInfo); }}/>
                <Button icon='eye'
                  onClick={ (evt) => { this.onNavigateInto(evt, callSym); }}/>
                <Button icon='sticky note outline'
                  onClick={ (evt) => { this.onShowSymbolSheet(evt, callSym); }}/>
              </Button.Group>
              &nbsp;<a onClick={ (evt) => { this.onShowSymbolPopup(evt, callSym); }}>{ callSym.prettiestName }</a>
            </List.Item>
          );
        }

        return (
          <Tab.Pane>
            { symItems }
          </Tab.Pane>
        );
      }
    });


    return (
      <Tab
        menu={{ attached: 'top' }}
        panes={ panes }
        />
    );
  }
}

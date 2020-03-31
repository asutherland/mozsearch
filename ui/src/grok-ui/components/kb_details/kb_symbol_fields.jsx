/* eslint-disable react/jsx-key */
import React from 'react';

import { Button, List, Tab, Table } from 'semantic-ui-react';

/**
 * Widget to show the fields for a given SymbolInfo and its ancestors.
 */
export default class KBSymbolFields extends React.Component {
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

  _renderSymbolFields(symInfo) {
    if (!symInfo.fields) {
      return <h3>{ symInfo.prettiestName }</h3>;
    }

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
      <React.Fragment>
        <h3>{ symInfo.prettiestName }</h3>
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
      </React.Fragment>
    );
  }

  render() {
    const { symInfo } = this.props;
    const ancestry = symInfo.getLinearizedAncestors(true);
    const tables = ancestry.map(sym => this._renderSymbolFields(sym));

    return (
      <React.Fragment>
        { tables }
      </React.Fragment>
    )
  }
}
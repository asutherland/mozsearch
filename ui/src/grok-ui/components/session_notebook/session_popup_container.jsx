import React from 'react';

import DirtyingComponent from '../dirtying_component.js';

import { Popup } from 'semantic-ui-react';

import './session_popup_container.css';

/**
 * Wraps a Semantic-UI Popup, displaying it when the SessionManager indicates
 * a popup should be displayed, and populating it with the desired popup type.
 */
export default class SessionPopupContainer extends DirtyingComponent {
  constructor(props) {
    // the notebook is characterized by the track.  The function is only invoked
    // after the constructor completes, so it's okay to access our convenience
    // variable initialized below.
    super(
      props,
      function () { return this.props.grokCtx.sessionManager.popupManager; });

    this.sessionManager = this.props.grokCtx.sessionManager;
    this.popupManager = this.sessionManager.popupManager;

    this.lastPopupInfo = null;

    this._bound_linkClickHandler = this.onLinkClick.bind(this);
  }


  onLinkClick(evt) {
    if (evt.target.tagName !== 'A' || !evt.target.href) {
      return;
    }

    const grokCtx = this.sessionManager.grokCtx;
    if (grokCtx.historyHelper.navigateTo(evt.target.href)) {
      evt.preventDefault();
      evt.stopPropagation();
      this.popupManager.popupClosed(this.lastPopupInfo);
    }
  }

  render() {
    const popupManager = this.popupManager;
    const popupInfo = popupManager.popupInfo;
    const isOpen = popupInfo !== null;

    let widgetInfo;
    let context = null;
    let offset = null;

    if (isOpen) {
      if (this.lastPopupInfo === popupInfo) {
        widgetInfo = this.lastWidgetInfo;
      } else {
        widgetInfo = this.lastWidgetInfo =
          popupInfo.binding.factory(
            popupInfo.payload, this.props.grokCtx, popupInfo.sessionThing);
      }
      this.lastPopupInfo = popupInfo;
      // The original searchfox popup and the DXR popup before it were always
      // positioned based on the click position.  The Popup widget we're using
      // likes to position things relative to the edges of elements, but can
      // be offset.  We could abandon using this widget in favor of our own
      // absolute positioning (as the original does), but it's nice to have the
      // menu bumped so that it's visible.
      //
      // So for now we target the popup at the bottom left but with an offset so
      // that it's closer to the mouse.
      const evt = popupInfo.triggeringEvent;
      if (evt) {
        context = evt.target;
        const bounds = evt.target.getBoundingClientRect();
        const x = evt.clientX - bounds.left;
        const y  = evt.clientY - bounds.top;
        offset = `${Math.floor(x)}, 0`;
      }
      //console.log("showing popup", widgetInfo, popupInfo, "context:", context);
    } else {
      this.lastPopupInfo = null;
      this.lastWidgetInfo = null;
      widgetInfo = { popupProps: {}, contents: null };
    }

    return (
      <Popup {...widgetInfo.popupProps}
        ref={ this.rootRef }
        className={ this.props.className }
        open={ isOpen }
        context={ context }
        offset={ offset }
        basic
        flowing
        position="bottom left"
        onClick={ this._bound_linkClickHandler }
        onClose={ () => { popupManager.popupClosed(popupInfo); } }
        >
          { widgetInfo.contents }
      </Popup>
    );
  }
}

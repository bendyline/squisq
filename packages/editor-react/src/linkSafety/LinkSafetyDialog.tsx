/**
 * LinkSafetyDialog — asks before a web link leaves the document.
 *
 * Shows the site the browser will contact, the full address, and anything
 * about the address that suggests it is not what it looks like. Cancel has
 * the focus, so a stray Enter never opens a link. "Always open links to …"
 * appears only when the host can remember the choice.
 *
 * Shares the link dialog's frame and modal contract (`useModalDialog`).
 */

import { useId, useRef, useState } from 'react';
import { useModalDialog } from '../modal/useModalDialog';
import type { LinkInspection } from './inspectLink';

export interface LinkSafetyDialogProps {
  inspection: LinkInspection;
  /** Offer "Always open links to <host>". */
  canTrust: boolean;
  /** The reader chose Open; `trust` when they also ticked "Always open". */
  onOpen: (trust: boolean) => void;
  onClose: () => void;
}

function warningsFor(inspection: LinkInspection): string[] {
  const { host, userName, textHost, leadsTo, internationalHost, insecure } = inspection;
  const warnings: string[] = [];
  if (userName) {
    warnings.push(
      `The address starts with “${userName}”, but that part is only a name. The link goes to ${host}.`,
    );
  }
  if (textHost) warnings.push(`The link says ${textHost}, but it goes to ${host}.`);
  if (leadsTo) warnings.push(`${host} then sends you on to ${leadsTo.hostname}.`);
  if (internationalHost) {
    warnings.push(
      'This site’s name uses letters from another alphabet, shown here as your browser reads it. Names like this can imitate a familiar site.',
    );
  }
  if (insecure) warnings.push('This page is not encrypted (http).');
  return warnings;
}

export function LinkSafetyDialog({ inspection, canTrust, onOpen, onClose }: LinkSafetyDialogProps) {
  const [trust, setTrust] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const addressId = useId();
  useModalDialog({ rootRef: overlayRef, dialogRef, initialFocusRef: cancelRef, onClose });
  const warnings = warningsFor(inspection);

  return (
    <div
      ref={overlayRef}
      className="squisq-link-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="squisq-link-dialog squisq-link-safety-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={addressId}
        tabIndex={-1}
        data-testid="link-safety-dialog"
      >
        <div className="squisq-link-dialog-header">
          <h2 id={headingId} className="squisq-link-dialog-title">
            Open this link?
          </h2>
          <button
            type="button"
            className="squisq-link-dialog-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="squisq-link-dialog-body">
          <div className="squisq-link-safety-host">{inspection.host}</div>
          <code id={addressId} className="squisq-link-safety-address">
            {inspection.url.href}
          </code>
          {warnings.length > 0 ? (
            <ul className="squisq-link-safety-warnings">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {canTrust ? (
            <label className="squisq-link-safety-trust">
              <input
                type="checkbox"
                checked={trust}
                onChange={(event) => setTrust(event.target.checked)}
              />
              <span>Always open links to {inspection.host}</span>
            </label>
          ) : null}
        </div>
        <div className="squisq-link-dialog-footer">
          <button
            ref={cancelRef}
            type="button"
            className="squisq-link-dialog-btn squisq-link-dialog-btn--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="squisq-link-dialog-btn squisq-link-dialog-btn--primary"
            onClick={() => onOpen(trust)}
          >
            Open link
          </button>
        </div>
      </div>
    </div>
  );
}

export default LinkSafetyDialog;

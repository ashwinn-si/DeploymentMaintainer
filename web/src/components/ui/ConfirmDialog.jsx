import { useState } from 'react';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';
import { Input } from './Input.jsx';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  confirmText,
  loading = false,
}) {
  const [typed, setTyped] = useState('');
  const requiresTyping = Boolean(confirmText);
  const canConfirm = !requiresTyping || typed === confirmText;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <p className="text-sm">{description}</p> : null}
      {requiresTyping ? (
        <Input
          label={`Type "${confirmText}" to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
        />
      ) : null}
    </Modal>
  );
}

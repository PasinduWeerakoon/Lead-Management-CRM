import { useState } from 'react'
import { Input, Modal, Typography } from 'antd'

interface Props {
  open: boolean
  title: string
  okText: string
  initialName?: string
  onCancel: () => void
  onSubmit: (name: string) => Promise<void> | void
}

/** Mount it only while open (with a key) so the name starts fresh each time. */
export function NameViewModal({ open, title, okText, initialName = '', onCancel, onSubmit }: Props) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      okText={okText}
      okButtonProps={{ disabled: !name.trim(), loading: busy }}
      onOk={submit}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Saved views appear in the sidebar and keep their filters, so you can come back to this list any time.
      </Typography.Paragraph>
      <Input
        autoFocus
        maxLength={80}
        placeholder="e.g. Boston D365 decision-makers"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={submit}
      />
    </Modal>
  )
}

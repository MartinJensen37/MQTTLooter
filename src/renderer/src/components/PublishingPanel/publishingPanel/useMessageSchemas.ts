import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import MessageTemplateService, {
  type MessageTemplate,
} from '../../../services/MessageTemplateService';
import type { PayloadEncoding } from '../../../../../shared/payload';

type Feedback = (message: string, type?: string) => void;

/**
 * Message schemas in Publishing: the saved list, the chosen schema, its payload check and
 * import, export and delete. Filling the form from a schema stays with the panel.
 */
export function useMessageSchemas(
  payload: string,
  encoding: PayloadEncoding,
  showFeedback?: Feedback,
) {
  const [service] = useState(() => new MessageTemplateService());
  const [templates, setTemplates] = useState<MessageTemplate[]>(() => service.getAllTemplates());
  const [open, setOpen] = useState(false);
  const [dropdown, setDropdown] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const refresh = () => setTemplates(service.getAllTemplates());

  // Closing the section forgets the chosen schema.
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  // The payload is checked against the chosen schema as it is edited.
  const validation = useMemo(
    () =>
      open && selected && payload && encoding === 'utf8'
        ? service.validatePayload(selected, payload)
        : null,
    [open, selected, payload, encoding, service],
  );

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await service.importTemplates(file);
      refresh();
      if (result.imported > 0) {
        let message = `Imported ${result.imported} message schema${result.imported === 1 ? '' : 's'}`;
        if (result.errors.length > 0) message += ` with ${result.errors.length} error(s)`;
        showFeedback?.(message, 'success');
      }
      if (result.errors.length > 0 && result.imported === 0) {
        showFeedback?.(`Import failed: ${result.errors[0]}`, 'error');
      }
    } catch (error) {
      showFeedback?.(`Import failed: ${(error as Error).message}`, 'error');
    }
    event.target.value = '';
  };

  const exportAll = () => {
    try {
      const blob = new Blob([JSON.stringify(service.exportTemplates(), null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: `mqtt-message-schemas-${new Date().toISOString().slice(0, 19)}.json`,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showFeedback?.('Message schemas exported', 'success');
    } catch (error) {
      showFeedback?.(`Export failed: ${(error as Error).message}`, 'error');
    }
  };

  const confirmDelete = () => {
    if (pendingDelete) {
      const template = service.getTemplate(pendingDelete);
      if (service.deleteTemplate(pendingDelete)) {
        refresh();
        if (selected === pendingDelete) setSelected(null);
        showFeedback?.(`Deleted "${template?.name}"`, 'success');
      } else {
        showFeedback?.('The message schema could not be deleted', 'error');
      }
    }
    setPendingDelete(null);
  };

  const selectedName =
    templates.find((template) => template.id === selected)?.name ?? 'Choose a message schema';

  return {
    service,
    templates,
    open,
    setOpen,
    dropdown,
    setDropdown,
    selected,
    setSelected,
    selectedName,
    validation,
    importFile,
    exportAll,
    pendingDelete,
    setPendingDelete,
    confirmDelete,
  };
}

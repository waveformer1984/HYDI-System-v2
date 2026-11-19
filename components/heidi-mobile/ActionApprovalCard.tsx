import { useMemo, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import type { ApiError } from '../../lib/heidi-mobile/client/api';
import {
  chatActionTitle,
  createApprovalCardController,
  type ChatStreamAction,
  type TaskDecision,
} from '../../lib/heidi-mobile/client/taskDecision';
import { ConfirmSheet } from './ui';

export interface ActionCardSnapshot {
  key: string;
  action: ChatStreamAction;
  outcomeText?: string;
  outcomeOk?: boolean;
  settled: boolean;
}

interface Props {
  card: ActionCardSnapshot;
  online: boolean;
  onSettled: (_update: { outcomeText: string; outcomeOk: boolean }) => void;
  onTasksChanged: () => void;
  onAuthError: (_error: ApiError) => void;
}

export default function ActionApprovalCard({ card, online, onSettled, onTasksChanged, onAuthError }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<TaskDecision | null>(null);
  const title = chatActionTitle(card.action);

  const target = useMemo(
    () => ({ actionId: card.action.actionId, missionId: card.action.missionId }),
    [card.action.actionId, card.action.missionId],
  );

  const disabled = !online || busy || card.settled;

  const startConfirm = (decision: TaskDecision) => {
    if (disabled) return;
    setConfirm(decision);
  };

  const finish = async () => {
    if (!confirm) return;
    const controller = createApprovalCardController(online, target);
    controller.tap(confirm);
    setBusy(true);
    const outcome = await controller.confirm();
    setBusy(false);
    setConfirm(null);
    onSettled({ outcomeText: outcome.text, outcomeOk: outcome.ok });
    if (outcome.authError) onAuthError(outcome.authError);
    else onTasksChanged();
  };

  return (
    <article className={styles.card} style={{ marginTop: 8 }} aria-label={`Approval: ${title}`}>
      <div className={styles.itemTitle}>{title}</div>
      <div className={`${styles.muted} ${styles.small}`} style={{ marginTop: 4 }}>
        Needs your approval before HYDI runs it.
      </div>
      {card.outcomeText && (
        <p className={card.outcomeOk ? styles.muted : styles.errorText} role="status" style={{ marginBottom: 0 }}>
          {card.outcomeText}
        </p>
      )}
      {!card.settled && (
        <div className={styles.btnRow}>
          <button type="button" className={styles.btnDanger} disabled={disabled} onClick={() => startConfirm('reject')}>
            Reject
          </button>
          <button type="button" className={styles.btnPrimary} disabled={disabled} onClick={() => startConfirm('approve')}>
            Approve
          </button>
        </div>
      )}
      {confirm && (
        <ConfirmSheet
          title={confirm === 'approve' ? `Approve ${title}?` : `Reject ${title}?`}
          body={confirm === 'approve'
            ? `Approve ${title}? This lets Hydi run it.`
            : 'The action will be marked rejected and will not run.'}
          confirmLabel={confirm === 'approve' ? 'Approve & run' : 'Reject'}
          danger={confirm === 'reject'}
          busy={busy}
          onConfirm={() => void finish()}
          onCancel={() => { if (!busy) setConfirm(null); }}
        />
      )}
    </article>
  );
}
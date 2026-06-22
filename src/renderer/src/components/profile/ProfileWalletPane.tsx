import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  Trash,
  Wallet,
  X,
} from "../../assets/icons";
import type {
  ProfileWallet,
  WalletMutationResult,
} from "../../../../shared/wallets";
import { BASE_NETWORK_LABEL } from "../../../../shared/wallets";
import { AppModal, AppModalTitle } from "../modal/AppModal";
import { useI18n } from "../useI18n";

interface ProfileWalletPaneProps {
  profile: string;
}

type WalletMode = "create" | "import";

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ProfileWalletPane({
  profile,
}: ProfileWalletPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [wallets, setWallets] = useState<ProfileWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<WalletMode>("create");
  const [name, setName] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<WalletMutationResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadWallets = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setWallets(await window.hermesAPI.listWallets(profile));
    } catch {
      setError(t("agents.walletLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    void loadWallets();
  }, [loadWallets]);

  function resetModal(): void {
    setMode("create");
    setName("");
    setRecoveryPhrase("");
    setSubmitting(false);
    setCreated(null);
    setError("");
  }

  function openCreateModal(): void {
    resetModal();
    setModalOpen(true);
  }

  async function copyText(value: string, key: string): Promise<void> {
    await window.hermesAPI.copyToClipboard(value);
    setCopied(key);
    window.setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, 1600);
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError("");
    try {
      const result =
        mode === "create"
          ? await window.hermesAPI.createWallet(profile, name)
          : await window.hermesAPI.importWallet({
              profile,
              name,
              recoveryPhrase,
            });
      if (!result.success) {
        setError(result.error || t("agents.walletCreateFailed"));
        return;
      }
      setCreated(result);
      await loadWallets();
    } catch {
      setError(t("agents.walletCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    setError("");
    const result = await window.hermesAPI.deleteWallet(profile, id);
    if (!result.success) {
      setError(result.error || t("agents.walletDeleteFailed"));
      return;
    }
    setDeleteConfirmId(null);
    await loadWallets();
  }

  return (
    <div className="profile-modal-pane profile-wallet-pane">
      <div className="profile-wallet-toolbar">
        <div>
          <div className="profile-wallet-heading">
            {t("agents.walletTitle")}
          </div>
          <div className="profile-wallet-subtitle">
            {t("agents.walletNetwork", { network: BASE_NETWORK_LABEL })}
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
          <Plus size={15} />
          {t("agents.walletCreate")}
        </button>
      </div>

      {loading ? (
        <div className="profile-modal-loading">
          <div className="loading-spinner" />
        </div>
      ) : wallets.length === 0 ? (
        <div className="profile-wallet-empty">
          <Wallet size={36} />
          <span>{t("agents.walletEmpty")}</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={openCreateModal}
          >
            <Plus size={15} />
            {t("agents.walletCreate")}
          </button>
        </div>
      ) : (
        <div className="profile-wallet-list">
          {wallets.map((wallet) => (
            <div className="profile-wallet-card" key={wallet.id}>
              <div className="profile-wallet-card-main">
                <div className="profile-wallet-icon">
                  <Wallet size={18} />
                </div>
                <div className="profile-wallet-meta">
                  <div className="profile-wallet-name-row">
                    <span className="profile-wallet-name">{wallet.name}</span>
                    <span className="profile-wallet-network">
                      {BASE_NETWORK_LABEL}
                    </span>
                  </div>
                  <code className="profile-wallet-address">
                    {formatAddress(wallet.address)}
                  </code>
                </div>
              </div>
              <div className="profile-wallet-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyText(wallet.address, wallet.id)}
                >
                  {copied === wallet.id ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}
                  {copied === wallet.id
                    ? t("agents.walletCopied")
                    : t("agents.walletCopyAddress")}
                </button>
                <button
                  className="btn btn-danger-ghost btn-sm"
                  onClick={() => handleDelete(wallet.id)}
                >
                  <Trash size={14} />
                  {deleteConfirmId === wallet.id
                    ? t("agents.walletDeleteConfirm")
                    : t("agents.walletDelete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="agents-create-error">{error}</div>}

      <AppModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) resetModal();
        }}
        className="profile-wallet-modal"
        overlayClassName="profile-wallet-modal-overlay"
        labelledBy="profile-wallet-modal-title"
      >
        <div className="profile-wallet-modal-header">
          <AppModalTitle
            id="profile-wallet-modal-title"
            className="profile-wallet-modal-title"
          >
            {created?.success
              ? t("agents.walletRecoveryTitle")
              : t("agents.walletCreateTitle")}
          </AppModalTitle>
          <button
            className="profile-modal-close"
            onClick={() => setModalOpen(false)}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        {created?.success && created.recoveryPhrase ? (
          <div className="profile-wallet-modal-body">
            <div className="profile-wallet-recovery">
              <KeyRound size={22} />
              <p>{t("agents.walletRecoveryInfo")}</p>
              <div className="profile-wallet-phrase">
                {created.recoveryPhrase.split(" ").map((word, index) => (
                  <span key={`${word}-${index}`}>
                    <strong>{index + 1}</strong>
                    {word}
                  </span>
                ))}
              </div>
              <div className="profile-wallet-modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    copyText(created.recoveryPhrase || "", "recovery")
                  }
                >
                  {copied === "recovery" ? (
                    <Check size={16} />
                  ) : (
                    <Copy size={16} />
                  )}
                  {copied === "recovery"
                    ? t("agents.walletCopied")
                    : t("agents.walletCopyRecovery")}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setModalOpen(false)}
                >
                  {t("agents.walletDone")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="profile-wallet-modal-body">
            <div className="profile-wallet-mode">
              <button
                className={mode === "create" ? "active" : ""}
                onClick={() => setMode("create")}
              >
                {t("agents.walletCreateNew")}
              </button>
              <button
                className={mode === "import" ? "active" : ""}
                onClick={() => setMode("import")}
              >
                {t("agents.walletImportExisting")}
              </button>
            </div>

            <label className="profile-wallet-field">
              <span>{t("agents.walletName")}</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("agents.walletNamePlaceholder")}
              />
            </label>

            {mode === "import" && (
              <label className="profile-wallet-field">
                <span>{t("agents.walletRecoveryPhrase")}</span>
                <textarea
                  className="input profile-wallet-textarea"
                  value={recoveryPhrase}
                  onChange={(event) => setRecoveryPhrase(event.target.value)}
                  placeholder={t("agents.walletRecoveryPlaceholder")}
                />
              </label>
            )}

            {error && <div className="agents-create-error">{error}</div>}

            <div className="profile-wallet-modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setModalOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={
                  submitting || (mode === "import" && !recoveryPhrase.trim())
                }
              >
                {submitting
                  ? t("agents.walletCreating")
                  : t("agents.walletSave")}
              </button>
            </div>
          </div>
        )}
      </AppModal>
    </div>
  );
}

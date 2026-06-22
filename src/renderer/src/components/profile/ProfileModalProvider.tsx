import { useCallback, useMemo, useState } from "react";
import ProfileModal from "./ProfileModal";
import {
  ProfileModalContext,
  type OpenProfileOptions,
} from "./ProfileModalContext";

interface OpenState {
  name: string;
  opts?: OpenProfileOptions;
}

/**
 * Mounts the single global profile modal at the app root and exposes
 * `openProfile` / `closeProfile` via context (see `useProfileModal`). Only one
 * profile modal is open at a time; opening again replaces the target.
 */
export function ProfileModalProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState<OpenState | null>(null);

  const openProfile = useCallback(
    (name: string, opts?: OpenProfileOptions) => setOpen({ name, opts }),
    [],
  );
  const closeProfile = useCallback(() => setOpen(null), []);

  const value = useMemo(
    () => ({ openProfile, closeProfile }),
    [openProfile, closeProfile],
  );

  return (
    <ProfileModalContext.Provider value={value}>
      {children}
      {open && (
        <ProfileModal
          name={open.name}
          onClose={closeProfile}
          onChanged={open.opts?.onChanged}
          onDeleted={open.opts?.onDeleted}
        />
      )}
    </ProfileModalContext.Provider>
  );
}

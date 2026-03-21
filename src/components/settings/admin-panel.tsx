"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  toggleSignups,
  toggleSelfServiceAccountManagement,
  updateUserRole,
  updateUserDisplayName,
} from "@/actions/admin";
import { Check, Loader2, Pencil, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";

interface AdminPanelProps {
  currentUserId: string;
  signupsEnabled: boolean;
  selfServiceAccountManagement: boolean;
  users: {
    id: string;
    displayName: string | null;
    role: "ADMIN" | "USER";
    createdAt: string;
    emailConnectionCount: number;
  }[];
}

export function AdminPanel({
  currentUserId,
  signupsEnabled,
  selfServiceAccountManagement,
  users,
}: AdminPanelProps) {
  const [isToggling, startToggle] = useTransition();
  const [, startUpdate] = useTransition();
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Registration toggle */}
      <section>
        <h2 className="text-lg font-medium">Registration</h2>
        <div className="mt-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Open signups</p>
              <p className="text-xs text-muted-foreground">
                Allow new users to register accounts
              </p>
            </div>
            <Switch
              checked={signupsEnabled}
              disabled={isToggling}
              onCheckedChange={(checked) => {
                setError(null);
                startToggle(async () => {
                  try {
                    await toggleSignups(checked);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Failed to update",
                    );
                  }
                });
              }}
            />
          </div>
        </div>
      </section>

      {/* Self-service account management toggle */}
      <section>
        <h2 className="text-lg font-medium">Account Management</h2>
        <div className="mt-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                Self-service account management
              </p>
              <p className="text-xs text-muted-foreground">
                Allow users to add, edit, and remove their own email connections
              </p>
            </div>
            <Switch
              checked={selfServiceAccountManagement}
              disabled={isToggling}
              onCheckedChange={(checked) => {
                setError(null);
                startToggle(async () => {
                  try {
                    await toggleSelfServiceAccountManagement(checked);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Failed to update",
                    );
                  }
                });
              }}
            />
          </div>
        </div>
      </section>

      {/* Users table */}
      <section>
        <h2 className="text-lg font-medium">Users</h2>
        <div className="mt-4 rounded-lg border bg-card divide-y">
          {users.map((user) => (
            <AdminUserRow
              key={user.id}
              user={user}
              isCurrentUser={user.id === currentUserId}
              updatingUserId={updatingUserId}
              onRoleChange={(userId, newRole) => {
                setError(null);
                setUpdatingUserId(userId);
                startUpdate(async () => {
                  try {
                    await updateUserRole(userId, newRole);
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Failed to update role",
                    );
                  } finally {
                    setUpdatingUserId(null);
                  }
                });
              }}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function AdminUserRow({
  user,
  isCurrentUser,
  updatingUserId,
  onRoleChange,
}: {
  user: AdminPanelProps["users"][0];
  isCurrentUser: boolean;
  updatingUserId: string | null;
  onRoleChange: (userId: string, newRole: "ADMIN" | "USER") => void;
}) {
  const isAdmin = user.role === "ADMIN";
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(user.displayName || "");
  const [isSavingName, startSaveName] = useTransition();

  const handleSaveName = () => {
    if (!nameValue.trim()) return;
    startSaveName(async () => {
      try {
        await updateUserDisplayName(user.id, nameValue.trim());
        toast.success("Name updated");
        setEditingName(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update name",
        );
      }
    });
  };

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-6 text-sm w-32"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                disabled={isSavingName || !nameValue.trim()}
                onClick={handleSaveName}
              >
                {isSavingName ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="flex items-center gap-1 text-sm font-medium truncate hover:underline"
            >
              {user.displayName || "Unnamed user"}
              <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
            </button>
          )}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              isAdmin
                ? "bg-primary/10 text-primary"
                : "bg-secondary text-secondary-foreground"
            }`}
          >
            {isAdmin ? (
              <ShieldCheck className="h-3 w-3" />
            ) : (
              <User className="h-3 w-3" />
            )}
            {user.role}
          </span>
          {isCurrentUser && (
            <span className="text-xs text-muted-foreground">(you)</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {user.emailConnectionCount} connection
          {user.emailConnectionCount !== 1 ? "s" : ""}
          {" · "}
          joined {new Date(user.createdAt).toLocaleDateString()}
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={isCurrentUser || updatingUserId === user.id}
        onClick={() => {
          const newRole = isAdmin ? "USER" : "ADMIN";
          onRoleChange(user.id, newRole);
        }}
      >
        {updatingUserId === user.id ? (
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        ) : null}
        {isAdmin ? "Remove admin" : "Make admin"}
      </Button>
    </div>
  );
}

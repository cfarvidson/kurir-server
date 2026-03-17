"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toggleSignups, updateUserRole } from "@/actions/admin";
import { Loader2, ShieldCheck, User } from "lucide-react";

interface AdminPanelProps {
  currentUserId: string;
  signupsEnabled: boolean;
  users: {
    id: string;
    displayName: string | null;
    role: string;
    createdAt: string;
    emailConnectionCount: number;
  }[];
}

export function AdminPanel({
  currentUserId,
  signupsEnabled,
  users,
}: AdminPanelProps) {
  const [isToggling, startToggle] = useTransition();
  const [isUpdating, startUpdate] = useTransition();

  return (
    <>
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
                startToggle(async () => {
                  await toggleSignups(checked);
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
          {users.map((user) => {
            const isCurrentUser = user.id === currentUserId;
            const isAdmin = user.role === "ADMIN";

            return (
              <div
                key={user.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {user.displayName || "Unnamed user"}
                    </p>
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
                      <span className="text-xs text-muted-foreground">
                        (you)
                      </span>
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
                  disabled={isCurrentUser || isUpdating}
                  onClick={() => {
                    const newRole = isAdmin ? "USER" : "ADMIN";
                    startUpdate(async () => {
                      await updateUserRole(user.id, newRole);
                    });
                  }}
                >
                  {isUpdating ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : null}
                  {isAdmin ? "Remove admin" : "Make admin"}
                </Button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

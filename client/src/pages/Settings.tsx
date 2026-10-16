import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api, apiError } from "@/lib/api";
import { PageHeader } from "@/components/common/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { toast } from "sonner";

export default function Settings() {
  const { user, refetchUser } = useAuth();
  const { workspaceId } = useParams();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [name, setName] = useState(user?.name || "");
  const [jobTitle, setJobTitle] = useState(user?.jobTitle || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [prefs, setPrefs] = useState({ taskAssigned: true, mentions: true, comments: true, deadlines: true, workspaceInvites: true });

  useEffect(() => {
    setName(user?.name || "");
    setJobTitle(user?.jobTitle || "");
    setBio(user?.bio || "");
  }, [user]);

  // Google sends the browser back here after the Calendar consent screen (?calendar=connected | error)
  useEffect(() => {
    const status = searchParams.get("calendar");
    if (!status) return;
    if (status === "connected") {
      toast.success("Google Calendar connected. New meetings will get a real Google Meet link.");
      qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
    } else if (status === "error") {
      toast.error("Couldn't connect Google Calendar. Please try again.");
    }
    searchParams.delete("calendar");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: calendarStatus, isLoading: loadingCalendarStatus } = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: async () => (await api.get("/auth/google-calendar/status")).data.data as { connected: boolean },
  });

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.patch("/auth/me", { name, jobTitle, bio });
      await refetchUser();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const savePrefs = async () => {
    try {
      await api.patch("/auth/notification-preferences", prefs);
      toast.success("Notification preferences saved");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const connectGoogleCalendar = async () => {
    setConnecting(true);
    try {
      const res = await api.get(`/auth/google-calendar/connect-url?workspaceId=${workspaceId}`);
      window.location.href = res.data.data.url; // full-page redirect to Google's consent screen
    } catch (err) {
      toast.error(apiError(err));
      setConnecting(false);
    }
  };

  const disconnectGoogleCalendar = async () => {
    setDisconnecting(true);
    try {
      await api.post("/auth/google-calendar/disconnect");
      qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Google Calendar disconnected");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Manage your account and preferences" />
      <div className="p-6 max-w-2xl">
        <Tabs defaultValue={searchParams.get("calendar") ? "connections" : "account"}>
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="connections">Connected Accounts</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <TabsContent value="account">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Update your personal information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={user?.profileImage} />
                    <AvatarFallback className="text-lg">{initials(user?.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{user?.email}</p>
                    <p className="text-xs text-muted-foreground">Signed in</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="jobTitle">Job title</Label>
                  <Input id="jobTitle" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Product Designer" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A short introduction" />
                </div>
                <Button onClick={saveProfile} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notification preferences</CardTitle>
                <CardDescription>Choose what you get notified about</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries({
                  taskAssigned: "Task assigned to me",
                  mentions: "Mentions",
                  comments: "Comments on my tasks",
                  deadlines: "Upcoming deadlines",
                  workspaceInvites: "Workspace invitations",
                }).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={(prefs as any)[key]}
                      onCheckedChange={(v) => setPrefs((p) => ({ ...p, [key]: v }))}
                    />
                  </div>
                ))}
                <Button onClick={savePrefs}>Save preferences</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="connections">
            <Card>
              <CardHeader>
                <CardTitle>Connected Accounts</CardTitle>
                <CardDescription>Let Flowbase create real meeting links on services you use</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <CalendarDays className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Google Calendar</p>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        When connected, meetings you organize get a real Google Meet link, created on your own
                        Google Calendar, instead of a generic video room.
                      </p>
                      {calendarStatus?.connected && (
                        <Badge variant="secondary" className="mt-2 gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Connected
                        </Badge>
                      )}
                    </div>
                  </div>

                  {loadingCalendarStatus ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : calendarStatus?.connected ? (
                    <Button variant="outline" size="sm" onClick={disconnectGoogleCalendar} disabled={disconnecting}>
                      {disconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" onClick={connectGoogleCalendar} disabled={connecting}>
                      {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Connect
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Use the theme toggle in the top bar to switch between light, dark, and system.</CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
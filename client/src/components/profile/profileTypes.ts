export interface ProfileData {
  _id: string; name: string; email: string; emailVerified: boolean; profileImage: string | null; jobTitle: string; bio: string; phone: string;
  city: string; country: string; website: string; social: { linkedin?: string; github?: string; twitter?: string; instagram?: string };
  timezone: string; accountType: "owner" | "member" | null; createdAt: string; lastLoginAt: string | null; hasPassword: boolean; googleLinked: boolean;
}

export interface CompanyData {
  workspace: { _id: string; name: string; slug: string; description: string; logo: string | null; createdAt: string };
  owner: { _id: string; name: string; profileImage: string | null; jobTitle: string; email?: string; phone?: string } | null;
  company: Record<string, any>;
  memberCount: number;
  canEdit: boolean;
}
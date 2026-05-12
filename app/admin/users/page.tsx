import type { Metadata } from "next";
import { AdminUsersClient } from "@/src/components/admin/admin-users-client";

export const metadata: Metadata = {
  title: "Users · Admin · GTLNAV",
  description: "Manage GTLNAV users and operator roles.",
  robots: { index: false, follow: false },
};

export default function AdminUsersPage() {
  return <AdminUsersClient />;
}

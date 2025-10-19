"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { updateUser } from "@/lib/users";
import { createSupabaseActionClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type ActionResult = {
  success: boolean;
  message?: string;
};

const userUpdateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().max(120).optional(),
  role: z.enum(["venue_manager", "reviewer", "central_planner", "executive"]),
  venueId: z.union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
});

export async function updateUserAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }
  if (currentUser.role !== "central_planner") {
    return { success: false, message: "Only planners can change user access." };
  }

  const parsed = userUpdateSchema.safeParse({
    userId: formData.get("userId"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    venueId: formData.get("venueId")
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    await updateUser(parsed.data.userId, {
      fullName: parsed.data.fullName ?? null,
      role: parsed.data.role,
      venueId: parsed.data.venueId ? parsed.data.venueId : null
    });
    revalidatePath("/users");
    return { success: true, message: "User updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the user right now." };
  }
}

const inviteSchema = z.object({
  email: z.string().email({ message: "Enter a valid email" }),
  fullName: z.string().max(120).optional(),
  role: z.enum(["venue_manager", "reviewer", "central_planner", "executive"]),
  venueId: z.union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
});

export async function inviteUserAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }
  if (currentUser.role !== "central_planner") {
    return { success: false, message: "Only planners can invite users." };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    venueId: formData.get("venueId")
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  const adminClient = createSupabaseServiceRoleClient();
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: {
      full_name: parsed.data.fullName ?? undefined
    }
  });

  if (error && error.status !== 422) {
    console.error(error);
    return { success: false, message: "Invitation failed. Double-check the email." };
  }

  let userId = data?.user?.id ?? null;

  if (!userId) {
    const { data: existingList } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = existingList?.users?.find(
      (candidate) => candidate.email?.toLowerCase() === parsed.data.email.toLowerCase()
    );
    userId = match?.id ?? null;
  }

  try {
    if (userId) {
      const supabase = await createSupabaseActionClient();
      const { error: upsertError } = await supabase.from("users").upsert({
        id: userId,
        email: parsed.data.email,
        full_name: parsed.data.fullName ?? null,
        role: parsed.data.role,
        venue_id: parsed.data.venueId ? parsed.data.venueId : null
      });

      if (upsertError) {
        throw upsertError;
      }
    }

    revalidatePath("/users");
    return { success: true, message: "Invite sent." };
  } catch (upsertError) {
    console.error(upsertError);
    return { success: false, message: "Invitation sent but updating access failed." };
  }
}

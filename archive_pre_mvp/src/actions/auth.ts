"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SignInState = {
  error?: string;
};

const invalidCredentialsMessage =
  "We couldn't sign you in with those credentials. Please try again.";

export async function signInAction(
  _prevState: SignInState | undefined,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Email and password are required." };
  }

  const supabase = await createSupabaseServerClient({
    enableCookieManagement: true,
  });
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? invalidCredentialsMessage
          : error.message,
    };
  }

  redirect("/");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient({
    enableCookieManagement: true,
  });
  await supabase.auth.signOut();
  redirect("/login");
}

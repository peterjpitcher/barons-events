import type React from "react";
import { Resend } from "resend";
import { getServerEnv } from "@/lib/env";

let resendClient: Resend | null = null;

const getResendClient = () => {
  if (!resendClient) {
    const { RESEND_API_KEY } = getServerEnv();

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured.");
    }

    resendClient = new Resend(RESEND_API_KEY);
  }

  return resendClient;
};

type SendEmailArgs = {
  to: string | string[];
  subject: string;
  react: React.ReactElement;
};

export type SendTransactionalEmailResult = {
  id: string | null;
};

export const sendTransactionalEmail = async ({
  to,
  subject,
  react,
}: SendEmailArgs): Promise<SendTransactionalEmailResult> => {
  const resend = getResendClient();

  const { data, error } = await resend.emails.send({
    from: "EventHub by Barons <events@mg.barons.example>",
    to,
    subject,
    react,
  });

  if (error) {
    const message = error.message ?? "Failed to send email via Resend.";
    throw new Error(message);
  }

  return {
    id: data?.id ?? null,
  };
};

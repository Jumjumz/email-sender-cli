import { Command, program } from "commander";
import nodemailer from "nodemailer";
import fs from "fs";
import path, { resolve } from "path";
import { text } from "stream/consumers";

interface From {
  name: string;
  email: string;
}

interface Recipient {
  email: string;
  name: string;
  company?: string;
  [key: string]: string | undefined;
}

interface EmailData {
  subject: string;
  from: From;
  recipients: Recipient[];
}

interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

interface CLIOptions {
  template: string;
  data: string;
  dryRun?: boolean;
}

class SendEmailCLI {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupCommands();
  }

  private setupCommands(): void {
    this.program
      .name("email-sender")
      .description("Send emails using HTML templates and JSON data");

    this.program
      .command("send")
      .description("Send emails using template and data")
      .requiredOption("-t, --template <path>", "Path to HTML template file")
      .requiredOption("-d, --data <path>", "Path to JSON data file")
      .option("--dry-run", "Preview emails without sending", false)
      .action(async (options: CLIOptions) => {
        await this.sendCommand(options);
      });

    this.program
      .command("validate")
      .description("Validate template and data files without sending")
      .requiredOption("-t, --template <path>", "Path to HTML template file")
      .requiredOption("-d, --data <path>", "Path to JSON data file")
      .action(async (options: CLIOptions) => {
        await this.validateCommand(options);
      });

    this.program
      .command("config")
      .description("Show current SMTP configuration (without passwords)")
      .action(() => {
        this.configCommand();
      });
  }

  private async sendCommand(options: CLIOptions): Promise<void> {
    try {
      console.log("Starting email process...\n");

      const emailData = this.loadEmailData(options.data);

      console.log(`Loaded ${(await emailData).recipients.length} recipients`);

      const htmlTemplate = this.loadHTMLTempalte(options.template);

      console.log("Temlate loaded successfully");

      if (options.dryRun) {
        await this.previewEmails(emailData, htmlTemplate);
        return;
      }

      const smtpConfig = this.getSMTPConfig();
      await this.sendEmails(emailData, htmlTemplate, smtpConfig);
    } catch (error) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : "Unknown error"
      );
      process.exit(1);
    }
  }

  private async validateCommand(options: CLIOptions): Promise<void> {}

  private async configCommand(): Promise<void> {}

  private async sendEmails(
    emailData: EmailData,
    htmlTemplate: string,
    smtpConfig: SMTPConfig
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    });

    await transporter.verify();

    console.log("SMTP connection verifiedm");

    let successCount = 0;
    let failedCount = 0;

    console.log(
      `Sending emails to ${emailData.recipients.length} recipients.. \n`
    );

    for (const recipient of emailData.recipients) {
      try {
        const personalizedHTML = this.applyVariables(
          htmlTemplate,
          recipient,
          emailData.from
        );
        const personalizedSubject = this.applyVariables(
          emailData.subject,
          recipient,
          emailData.from
        );

        await transporter.sendMail({
          from: `"${emailData.from.name}" <${emailData.from.email}>`,
          to: recipient.email,
          subject: personalizedSubject,
          html: personalizedHTML,
        });

        console.log(`Sent to ${recipient.email}`);
        successCount++;

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to send email to ${recipient.email}:`, error);
        failedCount++;
      }
    }

    console.log("\n Final Results");
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failedCount}`);
  }

  private async previewEmails(
    emailData: EmailData,
    htmlTemplate: string
  ): Promise<void> {
    console.log("\nDRY RUN MODE - Previewing emails:\n");

    console.log(`Email Preview:`);
    console.log(`From: ${emailData.from.name} <${emailData.from.email}>`);
    console.log(`Recipients: ${emailData.recipients.length}\n`);

    // Show preview of first recipient
    const firstRecipient = emailData.recipients[0];
    const renderedContent = this.applyVariables(
      htmlTemplate,
      firstRecipient,
      emailData.from
    );
    const renderedSubject = this.applyVariables(
      emailData.subject,
      firstRecipient,
      emailData.from
    );

    console.log("--- First Recipient Preview ---");
    console.log(`To: ${firstRecipient.name} <${firstRecipient.email}>`);
    console.log(`Subject: ${renderedSubject}`);
    console.log("HTML Content:");
    console.log(renderedContent);
    console.log("\n--- End Preview ---");

    console.log(
      `\n Ready to send to ${emailData.recipients.length} recipients.`
    );
    console.log("Run without --dry-run to actually send emails.");
  }

  private loadEmailData(dataPath: string): EmailData {
    const absolutePath = path.resolve(dataPath);

    if (!fs.existsSync(absolutePath))
      throw new Error(`Data file not found: ${dataPath}`);

    const rawData = fs.readFileSync(absolutePath, "utf-8");
    const emailData: EmailData = JSON.parse(rawData);

    if (!emailData.subject || !emailData.from || !emailData.recipients)
      throw new Error(
        "Invalid data format. Must contain subject, from and recepients"
      );

    if (!Array.isArray(emailData.recipients))
      throw new Error("Recipients array is empty or invalid");

    return emailData;
  }

  private loadHTMLTempalte(tempaltePath: string): string {
    const absolutePath = path.resolve(tempaltePath);

    if (!fs.existsSync(absolutePath))
      throw new Error(`Template file not found: ${absolutePath}`);

    return fs.readFileSync(absolutePath, "utf-8");
  }

  private applyVariables(
    text: string,
    recepient: Recipient,
    from: From
  ): string {
    let result = text;

    result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key === "email") return recepient.email;
      if (key === "name") return recepient.name;
      return recepient[key] || match;
    });

    result = result.replace(/\{\{from\.(\w+)\}\}/g, (match, key) => {
      return from[key as keyof typeof from] || match;
    });

    return result;
  }

  private getSMTPConfig(): SMTPConfig {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const host = process.env.SMTP_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.SMTP_PORT || "587");

    if (!user || !pass)
      throw new Error(
        "SMTP credentials required. Set SMTP_USER and SMTP_PASS environment variables."
      );

    return {
      host,
      port,
      user,
      pass,
    };
  }

  public run(): void {
    this.program.parse();
  }
}

const cli = new SendEmailCLI();
cli.run();

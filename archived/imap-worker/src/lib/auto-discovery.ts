import { Effect } from 'effect';

export interface EmailProviderConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

// Common email provider configurations
const KNOWN_PROVIDERS: Record<string, EmailProviderConfig> = {
  'gmail.com': {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  'googlemail.com': {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  'outlook.com': {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: true,
  },
  'hotmail.com': {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: true,
  },
  'live.com': {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: true,
  },
  'yahoo.com': {
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  'icloud.com': {
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: true,
  },
  'me.com': {
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: true,
  },
  'aol.com': {
    imapHost: 'imap.aol.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.aol.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  'zoho.com': {
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  'protonmail.com': {
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecure: false,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    smtpSecure: false,
  },
};

/**
 * Extract domain from email address
 */
export const extractDomain = (email: string): string => {
  const match = email.match(/@(.+)$/);
  return match ? match[1].toLowerCase() : '';
};

/**
 * Try to discover email provider settings from Mozilla Thunderbird ISPDB
 */
const discoverFromMozillaISPDB = (domain: string): Effect.Effect<EmailProviderConfig, Error> =>
  Effect.gen(function* () {
    const url = `https://autoconfig.thunderbird.net/v1.1/${domain}`;

    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (error) => new Error(`Failed to fetch from Mozilla ISPDB: ${error}`),
    });

    if (!response.ok) {
      return yield* Effect.fail(new Error(`Mozilla ISPDB returned status ${response.status}`));
    }

    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new Error(`Failed to parse Mozilla ISPDB response: ${error}`),
    });

    // Parse XML response (simplified - in production, use a proper XML parser)
    const imapHostMatch = text.match(
      /<incomingServer type="imap">[\s\S]*?<hostname>(.*?)<\/hostname>[\s\S]*?<port>(.*?)<\/port>[\s\S]*?<socketType>(.*?)<\/socketType>/,
    );
    const smtpHostMatch = text.match(
      /<outgoingServer type="smtp">[\s\S]*?<hostname>(.*?)<\/hostname>[\s\S]*?<port>(.*?)<\/port>[\s\S]*?<socketType>(.*?)<\/socketType>/,
    );

    if (!imapHostMatch || !smtpHostMatch) {
      return yield* Effect.fail(new Error('Could not parse IMAP/SMTP settings from Mozilla ISPDB'));
    }

    const config: EmailProviderConfig = {
      imapHost: imapHostMatch[1],
      imapPort: parseInt(imapHostMatch[2], 10),
      imapSecure: imapHostMatch[3] === 'SSL',
      smtpHost: smtpHostMatch[1],
      smtpPort: parseInt(smtpHostMatch[2], 10),
      smtpSecure: smtpHostMatch[3] === 'SSL',
    };

    return config;
  });

/**
 * Try common domain patterns for auto-discovery
 */
const discoverFromCommonPatterns = (domain: string): Effect.Effect<EmailProviderConfig, Error> => {
  // Try common IMAP/SMTP hostname patterns
  const commonPatterns = [
    {
      imapHost: `imap.${domain}`,
      smtpHost: `smtp.${domain}`,
    },
    {
      imapHost: `mail.${domain}`,
      smtpHost: `mail.${domain}`,
    },
  ];

  // For now, return the first pattern as a fallback
  // In production, you would test connectivity to these hosts
  const config: EmailProviderConfig = {
    imapHost: commonPatterns[0].imapHost,
    imapPort: 993,
    imapSecure: true,
    smtpHost: commonPatterns[0].smtpHost,
    smtpPort: 587,
    smtpSecure: true,
  };

  return Effect.succeed(config);
};

/**
 * Auto-discover email provider settings for a given email address
 */
export const discoverEmailProvider = (email: string): Effect.Effect<EmailProviderConfig, Error> =>
  Effect.gen(function* () {
    const domain = extractDomain(email);

    if (!domain) {
      return yield* Effect.fail(new Error('Invalid email address'));
    }

    // 1. Check known providers first (fastest)
    if (KNOWN_PROVIDERS[domain]) {
      console.log(`Using known provider configuration for ${domain}`);
      return KNOWN_PROVIDERS[domain];
    }

    // 2. Try Mozilla Thunderbird ISPDB
    console.log(`Attempting Mozilla ISPDB discovery for ${domain}`);
    const mozillaResult = yield* Effect.either(discoverFromMozillaISPDB(domain));
    if (mozillaResult._tag === 'Right') {
      console.log(`Successfully discovered settings from Mozilla ISPDB for ${domain}`);
      return mozillaResult.right;
    }

    // 3. Fall back to common patterns
    console.log(`Falling back to common patterns for ${domain}`);
    return yield* discoverFromCommonPatterns(domain);
  });

/**
 * Validate email provider configuration by testing connectivity
 * This is a placeholder - actual implementation would test IMAP/SMTP connections
 */
export const validateProviderConfig = (
  config: EmailProviderConfig,
  username: string,
  _password: string,
): Effect.Effect<boolean, Error> => {
  // TODO: Implement actual IMAP/SMTP connectivity test
  // For now, just return true
  console.log('Validating provider config:', {
    imapHost: config.imapHost,
    smtpHost: config.smtpHost,
    username,
  });
  return Effect.succeed(true);
};

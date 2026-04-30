/**
 * mTLS Setup for Keeper
 * Mutual TLS or no TLS
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class mTLSSetup {
  constructor() {
    this.certDir = path.join(__dirname, '../certs');
  }

  /**
   * Generate CA certificate
   */
  async generateCA() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const cert = crypto.createCertificateSigningRequest({
      subject: {
        CN: 'ProtoForge Keeper CA',
        O: 'ProtoForge',
        OU: 'Security'
      }
    });

    // Self-sign the CA certificate
    const caCert = crypto.createCertificate({
      hash: 'sha256',
      subject: {
        CN: 'ProtoForge Keeper CA',
        O: 'ProtoForge',
        OU: 'Security'
      },
      issuer: {
        CN: 'ProtoForge Keeper CA',
        O: 'ProtoForge',
        OU: 'Security'
      },
      serialNumber: '1',
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      publicKey,
      privateKey,
      extensions: [
        {
          name: 'basicConstraints',
          ca: true,
          pathlenConstraint: 2
        },
        {
          name: 'keyUsage',
          keyCertSign: true,
          cRLSign: true
        }
      ]
    });

    await this.ensureCertDir();
    
    await fs.writeFile(path.join(this.certDir, 'ca-key.pem'), privateKey, { mode: 0o600 });
    await fs.writeFile(path.join(this.certDir, 'ca-cert.pem'), caCert);

    console.log('[mTLS] Generated CA certificate');
    return { caCert, caKey: privateKey };
  }

  /**
   * Generate server certificate
   */
  async generateServerCert(domain = 'localhost') {
    const caKey = await fs.readFile(path.join(this.certDir, 'ca-key.pem'));
    const caCert = await fs.readFile(path.join(this.certDir, 'ca-cert.pem'));

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const serverCert = crypto.createCertificate({
      hash: 'sha256',
      subject: {
        CN: domain,
        O: 'ProtoForge',
        OU: 'Keeper Service'
      },
      issuer: {
        CN: 'ProtoForge Keeper CA',
        O: 'ProtoForge',
        OU: 'Security'
      },
      serialNumber: '2',
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      publicKey,
      privateKey: caKey,
      extensions: [
        {
          name: 'basicConstraints',
          ca: false
        },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true
        },
        {
          name: 'extKeyUsage',
          serverAuth: true
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 'DNS', value: domain },
            { type: 'DNS', value: 'localhost' },
            { type: 'IP', value: '127.0.0.1' }
          ]
        }
      ]
    });

    await fs.writeFile(path.join(this.certDir, 'server-key.pem'), privateKey, { mode: 0o600 });
    await fs.writeFile(path.join(this.certDir, 'server-cert.pem'), serverCert);

    console.log(`[mTLS] Generated server certificate for ${domain}`);
    return { serverCert, serverKey: privateKey };
  }

  /**
   * Generate client certificate for an agent
   */
  async generateClientCert(agentId) {
    const caKey = await fs.readFile(path.join(this.certDir, 'ca-key.pem'));
    const caCert = await fs.readFile(path.join(this.certDir, 'ca-cert.pem'));

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const clientCert = crypto.createCertificate({
      hash: 'sha256',
      subject: {
        CN: agentId,
        O: 'ProtoForge',
        OU: 'Agent'
      },
      issuer: {
        CN: 'ProtoForge Keeper CA',
        O: 'ProtoForge',
        OU: 'Security'
      },
      serialNumber: Date.now().toString(),
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      publicKey,
      privateKey: caKey,
      extensions: [
        {
          name: 'basicConstraints',
          ca: false
        },
        {
          name: 'keyUsage',
          digitalSignature: true
        },
        {
          name: 'extKeyUsage',
          clientAuth: true
        }
      ]
    });

    const agentDir = path.join(this.certDir, 'agents', agentId);
    await fs.mkdir(agentDir, { recursive: true });

    await fs.writeFile(path.join(agentDir, 'client-key.pem'), privateKey, { mode: 0o600 });
    await fs.writeFile(path.join(agentDir, 'client-cert.pem'), clientCert);
    await fs.writeFile(path.join(agentDir, 'ca-cert.pem'), caCert);

    console.log(`[mTLS] Generated client certificate for agent: ${agentId}`);
    return {
      clientCert,
      clientKey: privateKey,
      caCert
    };
  }

  /**
   * Verify client certificate
   */
  verifyClientCert(clientCert) {
    const caCert = fs.readFileSync(path.join(this.certDir, 'ca-cert.pem'));
    
    // This would be done by TLS layer, but here's the logic
    const verified = crypto.verify(
      'sha256',
      clientCert,
      caCert.publicKey,
      caCert.signature
    );

    if (!verified) {
      throw new Error('Invalid client certificate');
    }

    // Extract agent ID from CN
    const subject = this.parseSubject(clientCert);
    return subject.CN;
  }

  /**
   * Parse certificate subject
   */
  parseSubject(cert) {
    // Simplified - in real implementation use proper ASN.1 parsing
    const lines = cert.toString().split('\n');
    const subject = {};
    
    for (const line of lines) {
      if (line.startsWith('Subject:')) {
        const parts = line.substring(8).split(', ');
        for (const part of parts) {
          const [key, value] = part.split('=');
          subject[key] = value;
        }
      }
    }
    
    return subject;
  }

  /**
   * Ensure cert directory exists
   */
  async ensureCertDir() {
    try {
      await fs.mkdir(this.certDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  /**
   * Generate certificate bundle for agent
   */
  async getAgentBundle(agentId) {
    const agentDir = path.join(this.certDir, 'agents', agentId);
    
    return {
      key: await fs.readFile(path.join(agentDir, 'client-key.pem')),
      cert: await fs.readFile(path.join(agentDir, 'client-cert.pem')),
      ca: await fs.readFile(path.join(agentDir, 'ca-cert.pem'))
    };
  }
}

module.exports = mTLSSetup;

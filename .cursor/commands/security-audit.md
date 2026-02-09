---
description: Comprehensive Security Audit - Vulnerabilities, Dependencies & Infrastructure
alwaysApply: false
---

# Security Audit

Perform a comprehensive security audit of the codebase to identify and fix vulnerabilities.

## 🔒 Security Audit Scope

This audit covers:
1. **Dependency Security** - Known vulnerabilities, outdated packages
2. **Code Security** - Common vulnerabilities, injection attacks, crypto
3. **Infrastructure Security** - Environment variables, access controls, network
4. **Authentication & Authorization** - Identity verification, access control
5. **Data Security** - Sensitive data handling, encryption, storage

## 🎯 Audit Instructions

### Phase 1: Dependency Audit

**Check for known vulnerabilities:**

For **Python** projects:
```bash
# Check for known vulnerabilities
pip-audit
# or
safety check

# Check outdated packages
pip list --outdated
```

For **Node.js/TypeScript** projects:
```bash
# Check for vulnerabilities
npm audit
# or
yarn audit

# Check outdated packages
npm outdated
```

For **C/C++ (PlatformIO)** projects:
```bash
# Check platformio.ini for outdated libraries
pio pkg outdated
```

**Review third-party dependencies:**
- [ ] Check licenses for compliance
- [ ] Verify package authenticity (typosquatting)
- [ ] Review dependency chain (transitive dependencies)
- [ ] Check for deprecated or unmaintained packages
- [ ] Verify package integrity (checksums)

**Report Format:**
```
## 🔍 Dependency Audit Results

### Critical Vulnerabilities
- Package: [name@version]
  CVE: [CVE-ID]
  Severity: CRITICAL
  Description: [vulnerability description]
  Fix: Update to [safe version]

### Outdated Packages
- [package]: [current] → [latest] (reason to update)
```

---

### Phase 2: Code Security Review

**🚨 CRITICAL: Check for Hardcoded Secrets**

Search patterns:
```regex
password\s*=\s*["'][^"']+["']
api_key\s*=\s*["'][^"']+["']
token\s*=\s*["'][^"']+["']
secret\s*=\s*["'][^"']+["']
private_key\s*=\s*["'][^"']+["']
```

Common formats to detect:
- AWS Keys: `AKIA...`, `ASIA...`
- GitHub Tokens: `ghp_...`, `gho_...`
- Stripe Keys: `sk_live_...`, `pk_live_...`
- JWT Tokens: `eyJ...`
- Private Keys: `-----BEGIN PRIVATE KEY-----`

**🚨 CRITICAL: Weak Cryptographic Algorithms**

Banned algorithms (NEVER use):
- **Hash**: MD2, MD4, MD5, SHA-0, SHA-1
- **Symmetric**: RC2, RC4, Blowfish, DES, 3DES
- **Key Exchange**: Static RSA, Anonymous Diffie-Hellman

Deprecated algorithms (avoid):
- **Symmetric**: AES-CBC, AES-ECB (use AES-GCM)
- **Signature**: RSA with PKCS#1 v1.5 padding

**Required**: Use modern algorithms
- **Hash**: SHA-256, SHA-384, SHA-512
- **Symmetric**: AES-256-GCM, ChaCha20
- **Key Exchange**: ECDHE, DHE with proper validation

**🚨 HIGH: Deprecated OpenSSL Functions**

Forbidden (per Broccoli requirements):
```c
// Deprecated - DO NOT USE
AES_encrypt()          → Use EVP_EncryptInit_ex()
AES_decrypt()          → Use EVP_DecryptInit_ex()
RSA_new()              → Use EVP_PKEY_new()
SHA1_Init()            → Use EVP_DigestInit_ex() with SHA-256
HMAC()                 → Use EVP_Q_MAC() with SHA-256+
```

**Common Vulnerabilities to Check:**

1. **SQL Injection**
   ```python
   # ❌ VULNERABLE
   query = f"SELECT * FROM users WHERE id = {user_id}"
   
   # ✅ SAFE
   query = "SELECT * FROM users WHERE id = %s"
   cursor.execute(query, (user_id,))
   ```

2. **Command Injection**
   ```python
   # ❌ VULNERABLE
   os.system(f"ls {user_input}")
   
   # ✅ SAFE
   subprocess.run(["ls", user_input], check=True)
   ```

3. **Path Traversal**
   ```python
   # ❌ VULNERABLE
   file_path = f"/data/{user_filename}"
   
   # ✅ SAFE
   safe_path = Path("/data") / Path(user_filename).name
   if not safe_path.resolve().is_relative_to("/data"):
       raise ValueError("Invalid path")
   ```

4. **XSS (Cross-Site Scripting)**
   ```typescript
   // ❌ VULNERABLE
   element.innerHTML = userInput;
   
   // ✅ SAFE
   element.textContent = userInput;
   // or use sanitization library
   ```

5. **Unsafe Deserialization**
   ```python
   # ❌ VULNERABLE
   data = pickle.loads(untrusted_data)
   
   # ✅ SAFE
   data = json.loads(untrusted_data)
   ```

6. **eval() Usage**
   ```javascript
   // ❌ NEVER USE
   eval(userInput);
   
   // ✅ Find alternative approaches
   ```

7. **Buffer Overflows (C/C++)**
   ```c
   // ❌ UNSAFE
   strcpy(dest, src);
   sprintf(buf, "%s", input);
   gets(buffer);
   
   // ✅ SAFE
   strncpy(dest, src, sizeof(dest) - 1);
   snprintf(buf, sizeof(buf), "%s", input);
   fgets(buffer, sizeof(buffer), stdin);
   ```

---

### Phase 3: Authentication & Authorization Security

**Authentication Review:**
- [ ] Password requirements enforced (length, complexity)
- [ ] Passwords hashed with strong algorithm (bcrypt, Argon2, scrypt)
- [ ] No password storage in logs or error messages
- [ ] Multi-factor authentication available
- [ ] Account lockout after failed attempts
- [ ] Session tokens cryptographically secure
- [ ] Session expiration implemented
- [ ] Secure password reset mechanism
- [ ] No timing attacks in authentication checks

**Authorization Review:**
- [ ] Principle of least privilege enforced
- [ ] Role-based access control (RBAC) properly implemented
- [ ] Authorization checks on every protected endpoint
- [ ] No horizontal privilege escalation (user accessing other user's data)
- [ ] No vertical privilege escalation (user gaining admin access)
- [ ] Direct object references are protected
- [ ] Authorization logic server-side (not client-side only)

**Example Checks:**
```typescript
// ❌ VULNERABLE - Client-side only check
if (user.isAdmin) {
  showAdminPanel();
}

// ✅ SECURE - Server-side verification
const response = await fetch('/api/admin', {
  headers: { Authorization: `Bearer ${token}` }
});
if (response.ok) {
  showAdminPanel();
}
```

---

### Phase 4: Data Security

**Sensitive Data Handling:**
- [ ] Personal data identified and classified
- [ ] Encryption at rest for sensitive data
- [ ] Encryption in transit (TLS 1.2+ only)
- [ ] No sensitive data in URLs or logs
- [ ] Proper data masking in UI
- [ ] Secure deletion mechanisms
- [ ] Data retention policies enforced

**Input Validation:**
- [ ] All user input validated (whitelist approach)
- [ ] Input length limits enforced
- [ ] Type checking performed
- [ ] Special characters sanitized
- [ ] File upload restrictions (type, size)
- [ ] Content-Type verification
- [ ] Rate limiting implemented

**Output Encoding:**
- [ ] All output properly encoded for context
- [ ] HTML entity encoding for web pages
- [ ] JSON encoding for APIs
- [ ] SQL parameter binding for databases
- [ ] URL encoding for URLs

---

### Phase 5: Infrastructure Security

**Environment Variables:**
- [ ] All secrets in environment variables (not hardcoded)
- [ ] `.env` file in `.gitignore`
- [ ] No `.env` files committed to repository
- [ ] Environment-specific configurations separated
- [ ] Secrets rotation policy in place
- [ ] Access to production secrets restricted

**Access Controls:**
- [ ] Principle of least privilege for service accounts
- [ ] Database credentials restricted
- [ ] API keys scoped appropriately
- [ ] SSH keys properly managed
- [ ] Admin access audited and logged
- [ ] Service-to-service authentication implemented

**Network Security:**
- [ ] HTTPS enforced (no mixed content)
- [ ] HSTS header configured
- [ ] CORS properly configured
- [ ] CSP (Content Security Policy) implemented
- [ ] No exposed debug endpoints
- [ ] Firewall rules properly configured
- [ ] Internal services not publicly accessible

**Security Headers:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

---

## 📊 Audit Report Format

Provide results in this structure:

```markdown
# Security Audit Report
Date: [YYYY-MM-DD]

## Executive Summary
- Total issues found: [count]
- Critical: [count]
- High: [count]
- Medium: [count]
- Low: [count]

## 🔴 Critical Vulnerabilities (Fix Immediately)

### 1. [Vulnerability Name]
**Severity:** CRITICAL
**Location:** [file:line]
**Description:** [detailed description]
**Impact:** [security impact]
**Evidence:**
```[language]
[code snippet]
```
**Remediation:**
```[language]
[fixed code]
```
**CVE/Reference:** [if applicable]

## 🟠 High Priority Issues

### 1. [Issue Name]
**Severity:** HIGH
**Location:** [file:line]
**Description:** [description]
**Remediation:** [fix steps]

## 🟡 Medium Priority Issues

### 1. [Issue Name]
**Severity:** MEDIUM
**Impact:** [impact]
**Remediation:** [fix steps]

## 🔵 Low Priority / Hardening Recommendations

1. [Recommendation]

## ✅ Security Strengths
- [What's done well]

## 📋 Compliance Status
- [ ] OWASP Top 10 coverage
- [ ] PCI DSS compliance (if applicable)
- [ ] GDPR compliance (if applicable)
- [ ] SOC 2 requirements (if applicable)

## 🔄 Remediation Priority

**Immediate (0-24 hours):**
1. [Critical issue]

**Urgent (1-7 days):**
1. [High priority issue]

**Important (1-30 days):**
1. [Medium priority issue]

**Recommended (Backlog):**
1. [Low priority improvement]

## 📈 Security Metrics
- Files scanned: [count]
- Lines of code analyzed: [count]
- Dependencies checked: [count]
- Vulnerabilities patched: [count]
```

---

## 🔍 Automated Scanning Tools

Recommend running these tools:

**General Security:**
- `git-secrets` - Prevent committing secrets
- `truffleHog` - Find secrets in git history
- `gitleaks` - Detect hardcoded secrets

**Python:**
- `bandit` - Security linter for Python
- `safety` - Check dependencies for vulnerabilities
- `pip-audit` - Audit Python packages

**JavaScript/TypeScript:**
- `npm audit` / `yarn audit` - Check npm dependencies
- `eslint-plugin-security` - Security linting
- `snyk` - Find vulnerabilities

**C/C++:**
- `cppcheck` - Static analysis
- `valgrind` - Memory errors
- `AddressSanitizer` - Memory safety

---

## 🚀 Quick Security Scan Commands

```bash
# Python project
pip-audit && bandit -r . && safety check

# Node.js project
npm audit && eslint . --ext .js,.ts,.tsx

# C++ project (PlatformIO)
pio check --verbose

# Git history scan for secrets
truffleHog filesystem . --json

# Check for exposed secrets
git-secrets --scan
```

---

## 🎯 Priority Guidance

**Fix immediately (within 24 hours):**
- Hardcoded passwords, API keys, tokens
- SQL injection vulnerabilities
- Authentication bypass
- Remote code execution

**Fix urgently (within 7 days):**
- Weak cryptographic algorithms
- Authorization flaws
- XSS vulnerabilities
- Insecure deserialization

**Fix soon (within 30 days):**
- Missing input validation
- Outdated dependencies with CVEs
- Information disclosure
- Security misconfiguration

**Harden when possible:**
- Missing security headers
- Verbose error messages
- Insufficient logging
- Code quality improvements

---

## ✅ Post-Audit Actions

After completing the audit:

1. **Document findings** in security tracking system
2. **Create tickets** for each vulnerability
3. **Assign owners** for remediation
4. **Set deadlines** based on severity
5. **Re-scan** after fixes applied
6. **Update security policies** based on findings
7. **Schedule next audit** (quarterly recommended)

---

Ready to perform comprehensive security audit!

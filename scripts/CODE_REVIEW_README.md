# Code Review Tool

Comprehensive automated code review tool that checks Python, TypeScript/JavaScript, C/C++, and shell scripts against quality, security, and functionality standards.

## Features

### Review Categories

#### 🔍 Functionality
- Edge case handling
- Error handling patterns
- Language-specific anti-patterns
- Memory management (C/C++)
- Exception handling (Python)
- Type safety (TypeScript)

#### 📝 Code Quality
- Line length limits (120 chars)
- Missing docstrings/comments
- TODO/FIXME comments
- Type safety (TypeScript `any` usage)
- Console statements in production code
- Comparison operators (== vs ===)

#### 🔒 Security
- **Hardcoded credentials** (passwords, API keys, tokens)
- **Weak cryptographic algorithms** (MD5, SHA-1, DES, RC4, etc.)
- **Deprecated OpenSSL functions** (per Broccoli project requirements)
- SQL injection vulnerabilities
- `eval()` usage
- Unsafe C functions (strcpy, sprintf, gets, etc.)
- Buffer overflow risks

#### ⚡ Performance
- Basic performance anti-patterns

## Installation

No installation required! The script uses Python standard library only.

**Requirements:**
- Python 3.7+

## Usage

### Basic Usage

```bash
# Review a single file
./scripts/code_review.py path/to/file.py

# Review a directory (recursive)
./scripts/code_review.py firmware/src/

# Review with verbose output (shows code snippets)
./scripts/code_review.py -v path/to/file.cpp
```

### Advanced Usage

```bash
# Review only files in directory (not subdirectories)
./scripts/code_review.py --no-recursive website/src/

# Exit with error code if critical issues found (useful for CI/CD)
./scripts/code_review.py --fail-on-critical firmware/src/

# Exit with error code if high or critical issues found
./scripts/code_review.py --fail-on-high firmware/src/
```

### Integration with CI/CD

Add to your GitHub Actions workflow:

```yaml
- name: Code Review
  run: |
    python scripts/code_review.py --fail-on-critical firmware/src/
    python scripts/code_review.py --fail-on-critical website/src/
```

## Supported File Types

| Language | Extensions | Checks |
|----------|-----------|--------|
| **Python** | `.py` | Bare except clauses, missing docstrings, hardcoded secrets |
| **TypeScript/JS** | `.ts`, `.tsx`, `.js`, `.jsx` | `any` type usage, console statements, `==` vs `===` |
| **C/C++** | `.cpp`, `.cc`, `.c`, `.h`, `.hpp` | Unsafe functions, deprecated OpenSSL APIs, memory leaks |
| **Shell** | `.sh`, `.bash` | Unquoted variables, missing error handling (`set -e`) |

## Security Checks

### Hardcoded Credentials Detection

The tool detects various patterns of hardcoded secrets:

```python
# ❌ CRITICAL: Will be detected
password = "mypassword123"
api_key = "sk_live_abc123xyz"
token = "ghp_abc123xyz"

# ✅ GOOD: Use environment variables
password = os.getenv("PASSWORD")
api_key = os.getenv("API_KEY")
token = os.getenv("GITHUB_TOKEN")
```

### Weak Cryptographic Algorithms

```cpp
// ❌ HIGH: Deprecated and weak
SHA1_Init(&ctx);
HMAC(EVP_md5(), ...);
DES_encrypt(...);

// ✅ GOOD: Modern secure algorithms
EVP_DigestInit_ex(ctx, EVP_sha256(), NULL);
EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
```

### Deprecated OpenSSL Functions

Per Broccoli project requirements, these functions are flagged:

```cpp
// ❌ HIGH: Deprecated OpenSSL APIs
AES_encrypt(in, out, &key);
RSA_new();
SHA1_Init(&ctx);
HMAC();  // with SHA1

// ✅ GOOD: Use EVP high-level APIs
EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
EVP_PKEY_new();
EVP_DigestInit_ex(ctx, EVP_sha256(), NULL);
EVP_Q_MAC(NULL, "HMAC", NULL, "SHA256", ...);
```

## Output Format

### Issue Severity Levels

- 🔴 **CRITICAL**: Security vulnerabilities, hardcoded secrets
- 🟠 **HIGH**: Weak crypto, unsafe functions, type safety issues
- 🟡 **MEDIUM**: Missing error handling, potential bugs
- 🔵 **LOW**: Style issues, minor improvements
- ℹ️ **INFO**: Informational items (TODO comments)

### Example Output

```
================================================================================
Review: firmware/src/auth.cpp
================================================================================

Security (2 issues)
--------------------------------------------------------------------------------

🔴 CRITICAL: Hardcoded API key detected
  Line 42
  Code: api_key = "sk_live_abc123xyz"
  Fix: Use environment variables or secure vault instead

🟠 HIGH: Deprecated OpenSSL function: SHA1_Init()
  Line 78
  Code: SHA1_Init(&ctx);
  Fix: Use EVP high-level APIs instead

================================================================================
Statistics
================================================================================
  Total Lines: 250
  Non Empty Lines: 200
  Comment Lines: 45

================================================================================
Summary: 2 total issues
  🔴 Critical: 1
  🟠 High: 1
  🟡 Medium: 0
  🔵 Low: 0
  ℹ️  Info: 0
================================================================================
```

## Command-Line Options

```
usage: code_review.py [-h] [-v] [--no-recursive] [--fail-on-critical] [--fail-on-high] path

positional arguments:
  path                File or directory to review

optional arguments:
  -h, --help          show this help message and exit
  -v, --verbose       Show detailed output including code snippets
  --no-recursive      Do not review subdirectories
  --fail-on-critical  Exit with non-zero status if critical issues found
  --fail-on-high      Exit with non-zero status if high or critical issues found
```

## Integration Examples

### Pre-commit Hook

Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
set -e

echo "Running code review..."
python scripts/code_review.py --fail-on-critical $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(py|ts|tsx|cpp|h)$')
```

### GitHub Actions

```yaml
name: Code Review

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      
      - name: Review Firmware
        run: python scripts/code_review.py --fail-on-high firmware/src/
      
      - name: Review Website
        run: python scripts/code_review.py --fail-on-high website/src/
      
      - name: Review Scripts
        run: python scripts/code_review.py --fail-on-critical scripts/
```

### Makefile Integration

```makefile
.PHONY: review
review:
	@echo "Running code review..."
	@python scripts/code_review.py firmware/src/
	@python scripts/code_review.py website/src/
	@python scripts/code_review.py scripts/

.PHONY: review-strict
review-strict:
	@echo "Running strict code review..."
	@python scripts/code_review.py --fail-on-high firmware/src/
	@python scripts/code_review.py --fail-on-high website/src/
	@python scripts/code_review.py --fail-on-critical scripts/
```

## Extending the Tool

### Adding New Language Support

Create a new reviewer class:

```python
class RustReviewer(CodeReviewer):
    """Rust-specific code reviewer"""
    
    def check_functionality(self) -> None:
        # Add Rust-specific checks
        for line_num, line in enumerate(self.lines, 1):
            if 'unsafe' in line:
                self.result.add_issue(Issue(
                    category=Category.SECURITY,
                    severity=Severity.HIGH,
                    message="Unsafe code block detected",
                    line_number=line_num,
                    recommendation="Review unsafe code carefully"
                ))
```

Then register it:

```python
def get_reviewer(file_path: Path) -> Optional[CodeReviewer]:
    reviewers = {
        # ... existing reviewers ...
        '.rs': RustReviewer,
    }
```

### Adding Custom Security Patterns

Add patterns to `SECURITY_PATTERNS`:

```python
SECURITY_PATTERNS = {
    # ... existing patterns ...
    'hardcoded_secret': (
        r'secret\s*=\s*["\'][^"\']+["\']',
        "Hardcoded secret detected"
    ),
}
```

## Best Practices

1. **Run before committing**: Catch issues early
2. **Use in CI/CD**: Enforce standards across team
3. **Start with `--fail-on-critical`**: Gradually increase strictness
4. **Review regularly**: Don't let issues accumulate
5. **Customize for your project**: Add project-specific patterns

## Limitations

- **Static analysis only**: Cannot detect runtime issues
- **Pattern-based**: May have false positives/negatives
- **No execution**: Cannot validate logic correctness
- **Language-specific**: Best-effort for each language

## Troubleshooting

### "No reviewer available for .xyz files"

The file extension is not supported. Add a new reviewer class or use a supported extension.

### False Positives

Some patterns may flag legitimate code. Review the output and:
1. Add comments explaining why the code is safe
2. Refactor to use recommended patterns
3. Customize the tool's patterns for your project

## Contributing

To add new checks or improve existing ones:

1. Identify the pattern to detect
2. Add to appropriate reviewer class
3. Test with sample code
4. Update this README

## License

Part of the Led-Matrix-Webex project.

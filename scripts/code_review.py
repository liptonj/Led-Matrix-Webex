#!/usr/bin/env python3
"""
Code Review Tool

Performs comprehensive code review based on quality, security, and functionality checklist.
Analyzes Python, TypeScript/JavaScript, C/C++, and shell scripts.
"""

import argparse
import logging
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


class Severity(Enum):
    """Issue severity levels"""

    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class Category(Enum):
    """Review categories"""

    FUNCTIONALITY = "Functionality"
    CODE_QUALITY = "Code Quality"
    SECURITY = "Security"
    PERFORMANCE = "Performance"


@dataclass
class Issue:
    """Represents a code review issue"""

    category: Category
    severity: Severity
    message: str
    line_number: Optional[int] = None
    line_content: Optional[str] = None
    recommendation: Optional[str] = None


@dataclass
class ReviewResult:
    """Results of code review"""

    file_path: Path
    issues: List[Issue] = field(default_factory=list)
    stats: Dict[str, Any] = field(default_factory=dict)

    def add_issue(self, issue: Issue) -> None:
        """Add an issue to the review results"""
        self.issues.append(issue)

    def get_critical_count(self) -> int:
        """Get count of critical issues"""
        return sum(1 for issue in self.issues if issue.severity == Severity.CRITICAL)

    def get_high_count(self) -> int:
        """Get count of high severity issues"""
        return sum(1 for issue in self.issues if issue.severity == Severity.HIGH)


class CodeReviewer:
    """Base class for code reviewers"""

    # Security patterns - common across languages
    SECURITY_PATTERNS = {
        "hardcoded_password": (
            r'(password|passwd|pwd)\s*=\s*["\'][\w!@#$%^&*()]+["\']',
            "Hardcoded password detected",
        ),
        "hardcoded_api_key": (
            r'(api_key|apikey|access_key|secret_key)\s*=\s*["\'][A-Za-z0-9_\-]+["\']',
            "Hardcoded API key detected",
        ),
        "hardcoded_token": (
            r'(token|auth_token|bearer)\s*=\s*["\'][A-Za-z0-9_\-\.]+["\']',
            "Hardcoded token detected",
        ),
        "sql_injection": (
            r"(execute|query|sql)\s*\([^)]*\+[^)]*\)",
            "Potential SQL injection vulnerability (string concatenation)",
        ),
        "eval_usage": (r"\beval\s*\(", "Use of eval() - potential code injection risk"),
    }

    # Known weak crypto algorithms
    WEAK_CRYPTO = {
        "md5",
        "md4",
        "md2",
        "sha1",
        "sha-1",
        "des",
        "3des",
        "rc2",
        "rc4",
        "blowfish",
    }

    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.result = ReviewResult(file_path=file_path)
        self.lines: List[str] = []
        self.content: str = ""

    def read_file(self) -> bool:
        """Read file content"""
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                self.content = f.read()
                self.lines = self.content.split("\n")
            return True
        except Exception as e:
            logger.error(f"Failed to read {self.file_path}: {e}")
            return False

    def check_security(self) -> None:
        """Check for security issues"""
        # Check for hardcoded secrets
        for line_num, line in enumerate(self.lines, 1):
            line_lower = line.lower()

            # Check security patterns
            for pattern_name, (pattern, message) in self.SECURITY_PATTERNS.items():
                if re.search(pattern, line, re.IGNORECASE):
                    self.result.add_issue(
                        Issue(
                            category=Category.SECURITY,
                            severity=Severity.CRITICAL,
                            message=message,
                            line_number=line_num,
                            line_content=line.strip(),
                            recommendation="Use environment variables or secure vault instead",
                        )
                    )

            # Check for weak crypto algorithms
            for weak_algo in self.WEAK_CRYPTO:
                if weak_algo in line_lower:
                    self.result.add_issue(
                        Issue(
                            category=Category.SECURITY,
                            severity=Severity.HIGH,
                            message=f"Weak cryptographic algorithm detected: {weak_algo}",
                            line_number=line_num,
                            line_content=line.strip(),
                            recommendation="Use SHA-256, SHA-384, SHA-512, AES-256-GCM, or ChaCha20",
                        )
                    )

    def check_code_quality(self) -> None:
        """Check basic code quality issues"""
        # Check line length
        max_line_length = 120
        for line_num, line in enumerate(self.lines, 1):
            if len(line) > max_line_length:
                self.result.add_issue(
                    Issue(
                        category=Category.CODE_QUALITY,
                        severity=Severity.LOW,
                        message=f"Line too long ({len(line)} characters, max {max_line_length})",
                        line_number=line_num,
                        recommendation="Break long lines for readability",
                    )
                )

        # Check for TODO/FIXME comments
        for line_num, line in enumerate(self.lines, 1):
            if re.search(r"\b(TODO|FIXME|HACK|XXX)\b", line, re.IGNORECASE):
                self.result.add_issue(
                    Issue(
                        category=Category.CODE_QUALITY,
                        severity=Severity.INFO,
                        message="Unresolved TODO/FIXME comment",
                        line_number=line_num,
                        line_content=line.strip(),
                    )
                )

    def calculate_stats(self) -> None:
        """Calculate file statistics"""
        self.result.stats = {
            "total_lines": len(self.lines),
            "non_empty_lines": sum(1 for line in self.lines if line.strip()),
            "comment_lines": 0,  # Subclass-specific
        }

    def review(self) -> ReviewResult:
        """Perform complete review"""
        if not self.read_file():
            return self.result

        self.check_security()
        self.check_code_quality()
        self.check_functionality()
        self.calculate_stats()

        return self.result

    def check_functionality(self) -> None:
        """Check functionality - to be implemented by subclasses"""
        pass


class PythonReviewer(CodeReviewer):
    """Python-specific code reviewer"""

    def check_functionality(self) -> None:
        """Check Python-specific functionality issues"""
        # Check for bare except clauses
        for line_num, line in enumerate(self.lines, 1):
            if re.search(r"^\s*except\s*:", line):
                self.result.add_issue(
                    Issue(
                        category=Category.FUNCTIONALITY,
                        severity=Severity.MEDIUM,
                        message="Bare except clause - catches all exceptions",
                        line_number=line_num,
                        line_content=line.strip(),
                        recommendation="Catch specific exception types",
                    )
                )

        # Check for missing docstrings on functions/classes
        function_pattern = r"^\s*def\s+(\w+)\s*\("
        class_pattern = r"^\s*class\s+(\w+)"

        for line_num, line in enumerate(self.lines, 1):
            if re.search(function_pattern, line) or re.search(class_pattern, line):
                # Check if next non-empty line is a docstring
                has_docstring = False
                for next_line in self.lines[line_num : line_num + 3]:
                    if next_line.strip().startswith(
                        '"""'
                    ) or next_line.strip().startswith("'''"):
                        has_docstring = True
                        break
                    if next_line.strip() and not next_line.strip().startswith("#"):
                        break

                if not has_docstring and not line.strip().startswith("def __"):
                    self.result.add_issue(
                        Issue(
                            category=Category.CODE_QUALITY,
                            severity=Severity.LOW,
                            message="Missing docstring",
                            line_number=line_num,
                            line_content=line.strip(),
                            recommendation="Add docstring describing purpose and parameters",
                        )
                    )

    def calculate_stats(self) -> None:
        """Calculate Python-specific statistics"""
        super().calculate_stats()
        comment_lines = sum(1 for line in self.lines if line.strip().startswith("#"))
        self.result.stats["comment_lines"] = comment_lines


class TypeScriptReviewer(CodeReviewer):
    """TypeScript/JavaScript-specific code reviewer"""

    def check_functionality(self) -> None:
        """Check TypeScript-specific functionality issues"""
        # Check for console.log in production code
        for line_num, line in enumerate(self.lines, 1):
            if re.search(r"\bconsole\.(log|debug|info)\s*\(", line):
                self.result.add_issue(
                    Issue(
                        category=Category.CODE_QUALITY,
                        severity=Severity.LOW,
                        message="Console statement found - should use proper logging",
                        line_number=line_num,
                        line_content=line.strip(),
                        recommendation="Use proper logging framework or remove before production",
                    )
                )

        # Check for any type usage
        for line_num, line in enumerate(self.lines, 1):
            if re.search(r":\s*any\b", line):
                self.result.add_issue(
                    Issue(
                        category=Category.CODE_QUALITY,
                        severity=Severity.MEDIUM,
                        message="Use of 'any' type - loses type safety",
                        line_number=line_num,
                        line_content=line.strip(),
                        recommendation="Use specific types or unknown instead of any",
                    )
                )

        # Check for == instead of ===
        for line_num, line in enumerate(self.lines, 1):
            if re.search(r"[^=!<>]==[^=]", line):
                self.result.add_issue(
                    Issue(
                        category=Category.CODE_QUALITY,
                        severity=Severity.LOW,
                        message="Use === instead of == for type-safe comparison",
                        line_number=line_num,
                        line_content=line.strip(),
                    )
                )

    def calculate_stats(self) -> None:
        """Calculate TypeScript-specific statistics"""
        super().calculate_stats()
        comment_lines = sum(
            1
            for line in self.lines
            if line.strip().startswith("//") or line.strip().startswith("/*")
        )
        self.result.stats["comment_lines"] = comment_lines


class CppReviewer(CodeReviewer):
    """C/C++-specific code reviewer"""

    # Deprecated OpenSSL functions
    DEPRECATED_OPENSSL = {
        "AES_encrypt",
        "AES_decrypt",
        "RSA_new",
        "RSA_free",
        "SHA1_Init",
        "SHA1_Update",
        "SHA1_Final",
        "HMAC",
        "CMAC_Init",
        "AES_wrap_key",
        "AES_unwrap_key",
    }

    def check_functionality(self) -> None:
        """Check C/C++-specific functionality issues"""
        # Check for unsafe functions
        unsafe_functions = {
            "strcpy": "Use strncpy or strlcpy instead",
            "strcat": "Use strncat or strlcat instead",
            "sprintf": "Use snprintf instead",
            "gets": "Use fgets instead",
            "scanf": "Use with format width limits",
        }

        for line_num, line in enumerate(self.lines, 1):
            for func, recommendation in unsafe_functions.items():
                if re.search(rf"\b{func}\s*\(", line):
                    self.result.add_issue(
                        Issue(
                            category=Category.SECURITY,
                            severity=Severity.HIGH,
                            message=f"Unsafe function: {func}()",
                            line_number=line_num,
                            line_content=line.strip(),
                            recommendation=recommendation,
                        )
                    )

        # Check for deprecated OpenSSL functions
        for line_num, line in enumerate(self.lines, 1):
            for deprecated_func in self.DEPRECATED_OPENSSL:
                if re.search(rf"\b{deprecated_func}\s*\(", line):
                    self.result.add_issue(
                        Issue(
                            category=Category.SECURITY,
                            severity=Severity.HIGH,
                            message=f"Deprecated OpenSSL function: {deprecated_func}()",
                            line_number=line_num,
                            line_content=line.strip(),
                            recommendation="Use EVP high-level APIs instead",
                        )
                    )

        # Check for malloc without free
        malloc_pattern = r"\bmalloc\s*\("
        if re.search(malloc_pattern, self.content):
            if not re.search(r"\bfree\s*\(", self.content):
                self.result.add_issue(
                    Issue(
                        category=Category.FUNCTIONALITY,
                        severity=Severity.MEDIUM,
                        message="malloc() found but no corresponding free() - potential memory leak",
                        recommendation="Ensure proper memory cleanup",
                    )
                )

    def calculate_stats(self) -> None:
        """Calculate C/C++-specific statistics"""
        super().calculate_stats()
        comment_lines = sum(
            1
            for line in self.lines
            if line.strip().startswith("//") or line.strip().startswith("/*")
        )
        self.result.stats["comment_lines"] = comment_lines


class ShellReviewer(CodeReviewer):
    """Shell script-specific code reviewer"""

    def check_functionality(self) -> None:
        """Check shell script-specific functionality issues"""
        # Check for unquoted variables
        for line_num, line in enumerate(self.lines, 1):
            # Look for $VAR not in quotes (simple heuristic)
            if re.search(r'[^"]\$\w+[^"]', line) and "=" not in line:
                self.result.add_issue(
                    Issue(
                        category=Category.FUNCTIONALITY,
                        severity=Severity.LOW,
                        message="Unquoted variable - may cause word splitting issues",
                        line_number=line_num,
                        line_content=line.strip(),
                        recommendation='Use "$VAR" instead of $VAR',
                    )
                )

        # Check for missing error handling
        if "set -e" not in self.content and "set -o errexit" not in self.content:
            self.result.add_issue(
                Issue(
                    category=Category.FUNCTIONALITY,
                    severity=Severity.MEDIUM,
                    message="Script missing 'set -e' - errors may not be caught",
                    recommendation="Add 'set -e' at the beginning of script",
                )
            )

    def calculate_stats(self) -> None:
        """Calculate shell script-specific statistics"""
        super().calculate_stats()
        comment_lines = sum(1 for line in self.lines if line.strip().startswith("#"))
        self.result.stats["comment_lines"] = comment_lines


def get_reviewer(file_path: Path) -> Optional[CodeReviewer]:
    """Get appropriate reviewer for file type"""
    suffix = file_path.suffix.lower()

    reviewers = {
        ".py": PythonReviewer,
        ".ts": TypeScriptReviewer,
        ".tsx": TypeScriptReviewer,
        ".js": TypeScriptReviewer,
        ".jsx": TypeScriptReviewer,
        ".cpp": CppReviewer,
        ".cc": CppReviewer,
        ".cxx": CppReviewer,
        ".c": CppReviewer,
        ".h": CppReviewer,
        ".hpp": CppReviewer,
        ".sh": ShellReviewer,
        ".bash": ShellReviewer,
    }

    reviewer_class = reviewers.get(suffix)
    if reviewer_class:
        return reviewer_class(file_path)

    return None


def print_review_result(result: ReviewResult, verbose: bool = False) -> None:
    """Print review results in a readable format"""
    print(f"\n{'='*80}")
    print(f"Review: {result.file_path}")
    print(f"{'='*80}\n")

    if not result.issues:
        print("✓ No issues found!\n")
    else:
        # Group by category and severity
        by_category: Dict[Category, List[Issue]] = {}
        for issue in result.issues:
            by_category.setdefault(issue.category, []).append(issue)

        for category, issues in by_category.items():
            print(f"\n{category.value} ({len(issues)} issues)")
            print("-" * 80)

            for issue in issues:
                severity_icon = {
                    Severity.CRITICAL: "🔴",
                    Severity.HIGH: "🟠",
                    Severity.MEDIUM: "🟡",
                    Severity.LOW: "🔵",
                    Severity.INFO: "ℹ️",
                }

                print(
                    f"\n{severity_icon[issue.severity]} {issue.severity.value}: {issue.message}"
                )

                if issue.line_number:
                    print(f"  Line {issue.line_number}")

                if issue.line_content and verbose:
                    print(f"  Code: {issue.line_content}")

                if issue.recommendation:
                    print(f"  Fix: {issue.recommendation}")

    # Print statistics
    if result.stats:
        print(f"\n{'='*80}")
        print("Statistics")
        print(f"{'='*80}")
        for key, value in result.stats.items():
            print(f"  {key.replace('_', ' ').title()}: {value}")

    # Summary
    critical_count = result.get_critical_count()
    high_count = result.get_high_count()

    print(f"\n{'='*80}")
    print(f"Summary: {len(result.issues)} total issues")
    print(f"  🔴 Critical: {critical_count}")
    print(f"  🟠 High: {high_count}")
    print(
        f"  🟡 Medium: {sum(1 for i in result.issues if i.severity == Severity.MEDIUM)}"
    )
    print(f"  🔵 Low: {sum(1 for i in result.issues if i.severity == Severity.LOW)}")
    print(f"  ℹ️  Info: {sum(1 for i in result.issues if i.severity == Severity.INFO)}")
    print(f"{'='*80}\n")


def review_file(file_path: Path, verbose: bool = False) -> ReviewResult:
    """Review a single file"""
    reviewer = get_reviewer(file_path)

    if not reviewer:
        logger.warning(f"No reviewer available for {file_path.suffix} files")
        return ReviewResult(file_path=file_path)

    return reviewer.review()


def review_directory(
    directory: Path, recursive: bool = True, verbose: bool = False
) -> List[ReviewResult]:
    """Review all supported files in a directory"""
    results = []

    supported_extensions = {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".cpp",
        ".cc",
        ".c",
        ".h",
        ".hpp",
        ".sh",
        ".bash",
    }

    if recursive:
        pattern = "**/*"
    else:
        pattern = "*"

    for file_path in directory.glob(pattern):
        if file_path.is_file() and file_path.suffix.lower() in supported_extensions:
            # Skip test files and node_modules
            if "node_modules" in str(file_path) or "__pycache__" in str(file_path):
                continue

            logger.info(f"Reviewing {file_path}")
            result = review_file(file_path, verbose)
            results.append(result)

    return results


def main() -> int:
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Comprehensive code review tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Review a single file
  %(prog)s path/to/file.py
  
  # Review a directory (recursive)
  %(prog)s path/to/directory
  
  # Review with verbose output
  %(prog)s -v path/to/file.py
  
  # Review only files in directory (not subdirectories)
  %(prog)s --no-recursive path/to/directory
        """,
    )

    parser.add_argument("path", type=Path, help="File or directory to review")

    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Show detailed output including code snippets",
    )

    parser.add_argument(
        "--no-recursive", action="store_true", help="Do not review subdirectories"
    )

    parser.add_argument(
        "--fail-on-critical",
        action="store_true",
        help="Exit with non-zero status if critical issues found",
    )

    parser.add_argument(
        "--fail-on-high",
        action="store_true",
        help="Exit with non-zero status if high or critical issues found",
    )

    args = parser.parse_args()

    path = args.path

    if not path.exists():
        logger.error(f"Path does not exist: {path}")
        return 1

    results: List[ReviewResult] = []

    if path.is_file():
        result = review_file(path, args.verbose)
        results.append(result)
        print_review_result(result, args.verbose)
    elif path.is_dir():
        results = review_directory(path, not args.no_recursive, args.verbose)

        for result in results:
            print_review_result(result, args.verbose)

        # Overall summary
        total_issues = sum(len(r.issues) for r in results)
        total_critical = sum(r.get_critical_count() for r in results)
        total_high = sum(r.get_high_count() for r in results)

        print(f"\n{'='*80}")
        print(f"Overall Summary: {len(results)} files reviewed")
        print(f"{'='*80}")
        print(f"Total Issues: {total_issues}")
        print(f"  🔴 Critical: {total_critical}")
        print(f"  🟠 High: {total_high}")
        print(f"{'='*80}\n")

    # Determine exit code
    has_critical = any(r.get_critical_count() > 0 for r in results)
    has_high = any(r.get_high_count() > 0 for r in results)

    if args.fail_on_critical and has_critical:
        return 1

    if args.fail_on_high and (has_critical or has_high):
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

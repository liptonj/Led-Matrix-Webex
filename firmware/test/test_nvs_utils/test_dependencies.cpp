/**
 * @file test_dependencies.cpp
 * @brief Force linking of nvs_utils and globals for test_nvs_utils
 * 
 * This file ensures that nvs_utils.cpp and globals.cpp are compiled
 * and linked into the test binary. Without this, the test would fail
 * with linker errors for missing symbols.
 */

// Include the implementation files directly to force them into the build
#include "../../src/common/nvs_utils.cpp"
#include "../../simulation/mocks/globals.cpp"

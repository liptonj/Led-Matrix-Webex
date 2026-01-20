#pragma once

#include <stddef.h>
#include <stdint.h>

struct DisplaySizeConfig {
    uint16_t width;
    uint16_t height;
    uint16_t panel_res_x;
    uint16_t panel_res_y;
    uint8_t panel_chain;
};

enum DisplaySizeId : uint8_t {
    DISPLAY_SIZE_64x32 = 0,
    DISPLAY_SIZE_128x32 = 1,
    DISPLAY_SIZE_64x64 = 2,
};

constexpr DisplaySizeConfig kSupportedDisplaySizes[] = {
    {64, 32, 64, 32, 1},
    {128, 32, 64, 32, 2},
    {64, 64, 64, 64, 1},
};

#ifndef DISPLAY_SIZE_ID
#define DISPLAY_SIZE_ID DISPLAY_SIZE_64x32
#endif

static_assert(
    DISPLAY_SIZE_ID < (sizeof(kSupportedDisplaySizes) / sizeof(kSupportedDisplaySizes[0])),
    "DISPLAY_SIZE_ID out of range for kSupportedDisplaySizes"
);

constexpr DisplaySizeConfig kDisplaySize = kSupportedDisplaySizes[DISPLAY_SIZE_ID];

#ifdef MATRIX_WIDTH
#undef MATRIX_WIDTH
#endif
#ifdef MATRIX_HEIGHT
#undef MATRIX_HEIGHT
#endif
#ifdef PANEL_RES_X
#undef PANEL_RES_X
#endif
#ifdef PANEL_RES_Y
#undef PANEL_RES_Y
#endif
#ifdef PANEL_CHAIN
#undef PANEL_CHAIN
#endif

#define MATRIX_WIDTH kDisplaySize.width
#define MATRIX_HEIGHT kDisplaySize.height
#define PANEL_RES_X kDisplaySize.panel_res_x
#define PANEL_RES_Y kDisplaySize.panel_res_y
#define PANEL_CHAIN kDisplaySize.panel_chain

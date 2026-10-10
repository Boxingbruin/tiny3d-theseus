BUILD_DIR := build
SOURCE_DIR := .
include $(N64_INST)/include/n64.mk
include $(N64_INST)/include/t3d.mk
N64_C_AND_CXX_FLAGS += -L$(N64_LIBDIR)
N64_CXXFLAGS += -std=gnu++20 -fno-exceptions -fno-rtti -fno-coroutines
N64_ROM_TITLE := "Animation startup"
all: animation.z64
$(BUILD_DIR)/animation.elf: $(BUILD_DIR)/main.o
-include $(wildcard $(BUILD_DIR)/*.d)

$(BUILD_DIR)/fixtures.stamp: fixtures.py
	python3 fixtures.py
	@touch $@
$(BUILD_DIR)/animation.dfs: $(BUILD_DIR)/fixtures.stamp
animation.z64: $(BUILD_DIR)/animation.dfs

#include <libdragon.h>
#include <t3d/t3danim.h>
#include <cmath>
#include <cstdlib>

static void check(float actual, float expected) {
    assertf(std::isfinite(actual) && fabsf(actual-expected)<0.001f,
            "animation value %f, expected %f", double(actual), double(expected));
}

// Exercise the actual stream decoder without an importer or model fixture.
static void scalar(bool delayed) {
    auto* def=static_cast<T3DChunkAnim*>(calloc(1,sizeof(T3DChunkAnim)+sizeof(T3DAnimChannelMapping)));
    def->duration=0.2f; def->channelsScalar=1;
    def->channelMappings[0].targetType=T3D_ANIM_TARGET_TRANSLATION;
    def->channelMappings[0].quantScale=1;
    uint16_t stream[]={uint16_t(delayed?3:0),0,10,0,3,0,20};
    float value=0; int32_t changed=0;
    T3DAnimTargetScalar target{};
    target.targetScalar=&value; target.base.changedFlag=&changed;
    T3DAnim anim{};
    anim.animRef=def; anim.targetsScalar=&target;
    anim.file=fmemopen(stream,sizeof(stream),"rb");
    anim.nextKfSize=8;anim.speed=1;anim.isPlaying=1;anim.isLooping=1;
    assert(anim.file);
    t3d_anim_update(&anim,0);check(value,10);
    t3d_anim_update(&anim,0.025f);check(value,delayed?10:15);
    t3d_anim_update(&anim,0.025f);check(value,delayed?10:20);
    t3d_anim_set_time(&anim,0);t3d_anim_update(&anim,0);check(value,10);
    t3d_anim_set_time(&anim,0.2f);t3d_anim_update(&anim,0);check(value,10);
    fclose(anim.file);free(def);
}

static void quaternion() {
    auto* def=static_cast<T3DChunkAnim*>(calloc(1,sizeof(T3DChunkAnim)+sizeof(T3DAnimChannelMapping)));
    def->duration=0.2f;def->channelsQuat=1;
    def->channelMappings[0].targetType=T3D_ANIM_TARGET_ROTATION;
    uint16_t stream[]={0x8003,0,0xdff7,0xfdff,0x8003,0,0xdff7,0xfdff};
    T3DQuat value{};int32_t changed=0;
    T3DAnimTargetQuat target{};
    target.targetQuat=&value;target.base.changedFlag=&changed;
    T3DAnim anim{};anim.animRef=def;anim.targetsQuat=&target;
    anim.file=fmemopen(stream,sizeof(stream),"rb");
    anim.nextKfSize=8;anim.speed=1;anim.isPlaying=1;anim.isLooping=1;
    assert(anim.file);
    t3d_anim_update(&anim,0);check(value.v[3],1);
    t3d_anim_update(&anim,0.025f);check(value.v[3],1);
    t3d_anim_update(&anim,0.05f);check(value.v[3],1);
    t3d_anim_set_time(&anim,0);t3d_anim_update(&anim,0);check(value.v[3],1);
    t3d_anim_set_time(&anim,0.2f);t3d_anim_update(&anim,0);check(value.v[3],1);
    fclose(anim.file);free(def);
}
int main() {
    debug_init_isviewer();
    scalar(true); scalar(false); quaternion();
    debugf("Animation startup: PASS (delayed/zero start, interpolation, rewind, loop, quaternion)\n");
    for(;;){}
}

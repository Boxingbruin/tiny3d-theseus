#include <libdragon.h>
#include <t3d/t3danim.h>
#include <cmath>
#include <cstdlib>

static void check(float actual, float expected) {
    assertf(std::isfinite(actual) && fabsf(actual-expected)<0.001f,
            "animation value %f, expected %f", double(actual), double(expected));
}

// Construct only the animation definition; stream bytes live in DragonFS so the
// test exercises the actual async ROM reader, including half-buffer crossings.
static T3DModel* make_model(const char* file, bool quat, float duration) {
    const unsigned offset=sizeof(T3DModel)+sizeof(T3DChunkOffset);
    auto* model=static_cast<T3DModel*>(calloc(1,offset+sizeof(T3DChunkAnim)+sizeof(T3DAnimChannelMapping)));
    model->chunkCount=1;
    model->chunkOffsets[0].offset=(unsigned(T3D_CHUNK_TYPE_ANIM)<<24)|offset;
    auto* def=reinterpret_cast<T3DChunkAnim*>(reinterpret_cast<char*>(model)+offset);
    def->name=const_cast<char*>("test");def->filePath=const_cast<char*>(file);
    def->duration=duration;def->channelsQuat=quat;def->channelsScalar=!quat;
    def->channelMappings[0].targetType=quat?T3D_ANIM_TARGET_ROTATION:T3D_ANIM_TARGET_TRANSLATION;
    def->channelMappings[0].quantScale=1;
    return model;
}
static void scalar(bool delayed) {
    auto* model=make_model(delayed?"rom:/delayed.bin":"rom:/zero.bin",false,0.2f);
    float value=0; int32_t changed=0;
    T3DAnimTargetScalar target{};
    target.targetScalar=&value; target.base.changedFlag=&changed;
    auto anim=t3d_anim_create_buffered(model,"test",32);
    anim.targetsScalar=&target;
    t3d_anim_update(&anim,0);check(value,10);
    t3d_anim_update(&anim,0.025f);check(value,delayed?10:15);
    t3d_anim_update(&anim,0.025f);check(value,delayed?10:20);
    t3d_anim_set_time(&anim,0);t3d_anim_update(&anim,0);check(value,10);
    t3d_anim_set_time(&anim,0.2f);t3d_anim_update(&anim,0);check(value,10);
    anim.targetsQuat=nullptr;anim.targetsScalar=nullptr;t3d_anim_destroy(&anim);free(model);
}

static void quaternion() {
    auto* model=make_model("rom:/quat.bin",true,0.2f);
    T3DQuat value{};int32_t changed=0;
    T3DAnimTargetQuat target{};
    target.targetQuat=&value;target.base.changedFlag=&changed;
    auto anim=t3d_anim_create_buffered(model,"test",32);
    anim.targetsQuat=&target;
    t3d_anim_update(&anim,0);check(value.v[3],1);
    t3d_anim_update(&anim,0.025f);check(value.v[3],1);
    t3d_anim_update(&anim,0.05f);check(value.v[3],1);
    t3d_anim_set_time(&anim,0);t3d_anim_update(&anim,0);check(value.v[3],1);
    t3d_anim_set_time(&anim,0.2f);t3d_anim_update(&anim,0);check(value.v[3],1);
    anim.targetsQuat=nullptr;anim.targetsScalar=nullptr;t3d_anim_destroy(&anim);free(model);
}
static void streaming() {
    auto* model=make_model("rom:/long.bin",false,1.0f);
    float value=0;int32_t changed=0;
    T3DAnimTargetScalar target{};target.targetScalar=&value;target.base.changedFlag=&changed;
    auto anim=t3d_anim_create_buffered(model,"test",32);
    anim.targetsScalar=&target;
    for(unsigned cycle=0;cycle<4;++cycle) {
        t3d_anim_set_time(&anim,0);
        for(unsigned i=0;i<60;++i) {
            t3d_anim_set_time(&anim,float(i)/60.0f);
            t3d_anim_update(&anim,0);check(value,10+float(i));
        }
        // Loop after the stream has crossed and wrapped both DMA halves.
        t3d_anim_set_time(&anim,1.0f);t3d_anim_update(&anim,0);check(value,10);
        t3d_anim_set_time(&anim,0.4f);t3d_anim_update(&anim,0);check(value,34);
    }
    anim.targetsScalar=nullptr;t3d_anim_destroy(&anim);free(model);
}
int main() {
    debug_init_isviewer();
    dfs_init(DFS_DEFAULT_LOCATION);
    scalar(true); scalar(false); quaternion();streaming();
    debugf("Animation startup: PASS (delayed/zero start, interpolation, rewind, loop, quaternion, DMA boundaries)\n");
    for(;;){}
}

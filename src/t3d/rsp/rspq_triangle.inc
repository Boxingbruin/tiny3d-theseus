#include <rsp_rdpq_output.inc>

#########################################################################
#
#  RDPQ_Triangle: assemble a RDP triangle command
#
#  Selects one of two implementations:
#   - rspq_triangle_rspl.inc: RSPL version
#   - rspq_triangle_ref.inc:  the original libdragon assembly
#
##########################################################################


// #include "./rspq_triangle_ref.inc"
#include "./rspq_triangle_rspl.inc"
#include <rsp_prepared.inc>

#include <rsp_work.inc>

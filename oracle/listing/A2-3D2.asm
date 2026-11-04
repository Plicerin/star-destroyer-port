; A2-3D2, $6000-$80FA, 8443 bytes, as it is while the game flies.
; Produced by probe_renderer.mjs. The bytes are the resident image, which differs
; from the disk file in 115 places the engine patched into itself.
; Gaps printed as .byte are bytes nothing reaches from the entry points: the
; zero-page save area $600C-$606B, the dispatch table at
; $60DC, the sine table at $6147, and the engine's own variables.
;
$6000  RENDER:       4C 6C 60   JMP $606C
$6003  RENDER.NOSAVE:4C 90 60   JMP FRAME
$6006  COS:          4C F6 61   JMP $61F6
$6009  SIN:          4C 0F 62   JMP $620F
$600C  ZPSAVE:       .byte $08, $16, $08, $7E, $7E, $06, $08, $06, $08, $0F, $00, $F5, $F5, $3E, $10, $3E
$601C                .byte $10, $00, $00, $D3, $74, $C3, $24, $01, $D2, $3F, $01, $D2, $3F, $01, $D2, $3F
$602C                .byte $01, $D2, $3F, $01, $D2, $3F, $01, $D2, $3F, $01, $D2, $3F, $01, $D2, $3F, $01
$603C                .byte $D2, $3F, $01, $3E, $50, $3E, $50, $00, $00, $D3, $74, $F1, $F1, $E3, $E3, $E3
$604C                .byte $E3, $05, $00, $C3, $52, $01, $C2, $15, $01, $23, $00, $FE, $60, $FE, $60, $C3
$605C                .byte $5E, $01, $C2, $0B, $01, $00, $15, $C3, $66, $01, $C2, $0F, $01, $C3, $00, $00
$606C                08         PHP
$606D                48         PHA
$606E                8A         TXA
$606F                48         PHA
$6070                98         TYA
$6071                48         PHA
$6072                A2 60      LDX #$60
$6074                B5 5F      LDA $5F,X
$6076                9D 0B 60   STA $600B,X
$6079                CA         DEX
$607A                D0 F8      BNE $6074
$607C                20 90 60   JSR FRAME
$607F                A2 60      LDX #$60
$6081                BD 0B 60   LDA $600B,X
$6084                95 5F      STA $5F,X
$6086                CA         DEX
$6087                D0 F8      BNE $6081
$6089                68         PLA
$608A                A8         TAY
$608B                68         PLA
$608C                AA         TAX
$608D                68         PLA
$608E                28         PLP
$608F                60         RTS
$6090  FRAME:        D8         CLD
$6091                A2 21      LDX #$21
$6093                A9 00      LDA #$00
$6095                95 7B      STA $7B,X
$6097                CA         DEX
$6098                D0 FB      BNE $6095
$609A                A9 80      LDA #$80
$609C                85 9C      STA $9C
$609E                A9 FB      LDA #$FB
$60A0                85 9B      STA $9B
$60A2                A9 FD      LDA #$FD
$60A4                85 7E      STA $7E
$60A6                85 86      STA $86
$60A8                85 8E      STA $8E
$60AA                A9 7F      LDA #$7F
$60AC                85 7F      STA $7F
$60AE                85 87      STA $87
$60B0                85 8F      STA $8F
$60B2                A9 00      LDA #$00
$60B4                85 BB      STA $BB
$60B6                A9 20      LDA #$20
$60B8                85 BC      STA $BC
$60BA                A9 40      LDA #$40
$60BC                85 BD      STA $BD
$60BE                4C 18 61   JMP NEXTOP
$60C1  EMIT2:        C8         INY
$60C2                B1 9B      LDA ($9B),Y
$60C4                A0 01      LDY #$01
$60C6                91 9D      STA ($9D),Y
$60C8                88         DEY
$60C9                A9 12      LDA #$12
$60CB                91 9D      STA ($9D),Y
$60CD                A9 02      LDA #$02
$60CF                18         CLC
$60D0                18         CLC
$60D1                65 9D      ADC $9D
$60D3                85 9D      STA $9D
$60D5                90 02      BCC $60D9
$60D7                E6 9E      INC $9E
$60D9                4C B5 63   JMP ADV2
$60DC  DISPATCH:     .byte $DC, $62, $65, $62, $9A, $62, $C0, $62, $B0, $63, $BD, $63, $CE, $63, $DF, $63
$60EC                .byte $23, $76, $46, $7D, $EC, $63, $FB, $63, $81, $80, $09, $64, $2D, $64, $52, $64
$60FC                .byte $1A, $64, $28, $64, $74, $7D, $07, $6D, $3C, $80, $F5, $70, $2A, $71, $41, $71
$610C                .byte $6F, $71, $87, $71, $BF, $71, $D4, $71, $09, $72, $1A, $72
$6118  NEXTOP:       A9 0A      LDA #$0A
$611A                85 B1      STA $B1
$611C  NEXTOP.Y0:    A0 00      LDY #$00
$611E                B1 9B      LDA ($9B),Y
$6120                30 04      BMI $6126
$6122                C9 1E      CMP #$1E
$6124                30 09      BMI $612F
$6126                A5 7D      LDA $7D
$6128                F0 04      BEQ $612E
$612A                A9 79      LDA #$79
$612C                91 9D      STA ($9D),Y
$612E                60         RTS
$612F                0A         ASL A
$6130                AA         TAX
$6131                BD DC 60   LDA DISPATCH,X
$6134                85 A3      STA $A3
$6136                BD DD 60   LDA $60DD,X
$6139                85 A4      STA $A4
$613B                6C A3 00   JMP ($00A3)
$613E  ANGLE:        .byte $00, $00, $80, $3E, $FF, $7F, $45, $25, $FF, $7F, $F5, $7F, $D7, $7F, $A6, $7F
$614E                .byte $61, $7F, $09, $7F, $9C, $7E, $1C, $7E, $89, $7D, $E3, $7C, $29, $7C, $5C, $7B
$615E                .byte $7C, $7A, $89, $79, $83, $78, $6B, $77, $40, $76, $03, $75, $B5, $73, $54, $72
$616E                .byte $E1, $70, $5E, $6F, $C9, $6D, $23, $6C, $6C, $6A, $79, $67, $CE, $66, $E7, $64
$617E                .byte $F1, $62, $EB, $60, $D6, $5E, $B3, $5C, $81, $5A, $42, $58, $F4, $55, $9A, $53
$618E                .byte $33, $51, $BF, $4E, $3F, $4C, $B3, $49, $1C, $47, $7A, $44, $CD, $41, $16, $3F
$619E                .byte $56, $3C, $8C, $39, $B9, $36, $DE, $33, $FB, $30, $10, $2E, $1F, $2B, $26, $28
$61AE                .byte $27, $25, $23, $22, $19, $1F, $0B, $1C, $F9, $18, $E1, $15, $C7, $12, $AB, $0F
$61BE                .byte $8C, $0C, $6A, $09, $47, $06, $24, $03, $00, $00
$61C8  SIN.A:        38         SEC
$61C9                E9 40      SBC #$40
$61CB  COS.A:        AA         TAX
$61CC                30 1F      BMI $61ED
$61CE                C9 40      CMP #$40
$61D0                30 12      BMI $61E4
$61D2                18         CLC
$61D3                69 7F      ADC #$7F
$61D5                49 FF      EOR #$FF
$61D7                0A         ASL A
$61D8                A8         TAY
$61D9                38         SEC
$61DA                A9 00      LDA #$00
$61DC                F9 47 61   SBC SINTAB,Y
$61DF                AA         TAX
$61E0                F9 46 61   SBC $6146,Y
$61E3                60         RTS
$61E4                0A         ASL A
$61E5                A8         TAY
$61E6                BE 47 61   LDX SINTAB,Y
$61E9                B9 46 61   LDA $6146,Y
$61EC                60         RTS
$61ED                49 FF      EOR #$FF
$61EF                18         CLC
$61F0                69 01      ADC #$01
$61F2                10 DA      BPL $61CE
$61F4                30 E1      BMI $61D7
$61F6                08         PHP
$61F7                48         PHA
$61F8                8A         TXA
$61F9                48         PHA
$61FA                98         TYA
$61FB                48         PHA
$61FC                AD 3E 61   LDA ANGLE
$61FF                20 C8 61   JSR SIN.A
$6202                8E 3F 61   STX $613F
$6205                8D 3E 61   STA ANGLE
$6208                68         PLA
$6209                A8         TAY
$620A                68         PLA
$620B                AA         TAX
$620C                68         PLA
$620D                28         PLP
$620E                60         RTS
$620F                08         PHP
$6210                48         PHA
$6211                8A         TXA
$6212                48         PHA
$6213                98         TYA
$6214                48         PHA
$6215                AD 3E 61   LDA ANGLE
$6218                20 CB 61   JSR COS.A
$621B                4C 02 62   JMP $6202
$621E  MODE29:       .byte $00
$621F  ADVANCE:      18         CLC
$6220                65 9B      ADC $9B
$6222                85 9B      STA $9B
$6224                90 02      BCC $6228
$6226                E6 9C      INC $9C
$6228                60         RTS
$6229                A0 68      LDY #$68
$622B                20 4D 68   JSR FETCHPT
$622E                20 7B 6A   JSR OUTCODE2
$6231                A2 07      LDX #$07
$6233                B5 67      LDA $67,X
$6235                95 6F      STA $6F,X
$6237                CA         DEX
$6238                D0 F9      BNE $6233
$623A                A9 07      LDA #$07
$623C                20 1F 62   JSR ADVANCE
$623F                AD 1E 62   LDA MODE29
$6242                C9 02      CMP #$02
$6244                F0 1A      BEQ $6260
$6246                A5 66      LDA $66
$6248                25 6E      AND $6E
$624A                60         RTS
$624B                A0 60      LDY #$60
$624D                20 4D 68   JSR FETCHPT
$6250                20 22 6A   JSR OUTCODE1
$6253                A9 07      LDA #$07
$6255                20 1F 62   JSR ADVANCE
$6258                AD 1E 62   LDA MODE29
$625B                C9 02      CMP #$02
$625D                F0 01      BEQ $6260
$625F                60         RTS
$6260                68         PLA
$6261                68         PLA
$6262                4C 18 61   JMP NEXTOP
$6265  OP01:         20 4B 62   JSR $624B
$6268                20 29 62   JSR $6229
$626B                D0 50      BNE $62BD
$626D                A5 66      LDA $66
$626F                D0 14      BNE $6285
$6271                A5 6E      LDA $6E
$6273                D0 03      BNE $6278
$6275                4C 23 63   JMP $6323
$6278                A5 7C      LDA $7C
$627A                D0 41      BNE $62BD
$627C                20 EE 6A   JSR CLIP2
$627F                C6 B1      DEC $B1
$6281                F0 3A      BEQ $62BD
$6283                D0 EC      BNE $6271
$6285                A5 7C      LDA $7C
$6287                D0 34      BNE $62BD
$6289                20 D4 6A   JSR CLIP1
$628C                A5 66      LDA $66
$628E                F0 E1      BEQ $6271
$6290                25 6E      AND $6E
$6292                D0 29      BNE $62BD
$6294                C6 B1      DEC $B1
$6296                D0 F1      BNE $6289
$6298                F0 23      BEQ $62BD
$629A  OP02:         A2 07      LDX #$07
$629C                B5 6F      LDA $6F,X
$629E                95 5F      STA $5F,X
$62A0                CA         DEX
$62A1                D0 F9      BNE $629C
$62A3                20 29 62   JSR $6229
$62A6                D0 15      BNE $62BD
$62A8                A5 66      LDA $66
$62AA                D0 D9      BNE $6285
$62AC                A5 6E      LDA $6E
$62AE                F0 5E      BEQ $630E
$62B0                A5 7C      LDA $7C
$62B2                D0 09      BNE $62BD
$62B4                20 EE 6A   JSR CLIP2
$62B7                C6 B1      DEC $B1
$62B9                F0 02      BEQ $62BD
$62BB                D0 EF      BNE $62AC
$62BD                4C 18 61   JMP NEXTOP
$62C0  OP03:         A2 07      LDX #$07
$62C2                B5 6F      LDA $6F,X
$62C4                95 67      STA $67,X
$62C6                CA         DEX
$62C7                D0 F9      BNE $62C2
$62C9                20 4B 62   JSR $624B
$62CC                A5 66      LDA $66
$62CE                25 6E      AND $6E
$62D0                D0 EB      BNE $62BD
$62D2                A5 66      LDA $66
$62D4                D0 AF      BNE $6285
$62D6                A5 6E      LDA $6E
$62D8                D0 9E      BNE $6278
$62DA                F0 3D      BEQ $6319
$62DC  OP00:         20 4B 62   JSR $624B
$62DF                A5 66      LDA $66
$62E1                F0 03      BEQ $62E6
$62E3                4C 1C 61   JMP NEXTOP.Y0
$62E6                A0 60      LDY #$60
$62E8                A2 9F      LDX #$9F
$62EA                20 67 63   JSR $6367
$62ED                A8         TAY
$62EE                A6 9F      LDX $9F
$62F0                A5 7D      LDA $7D
$62F2                30 06      BMI $62FA
$62F4                20 1C 77   JSR PLOT2D
$62F7                4C 1C 61   JMP NEXTOP.Y0
$62FA                A9 0A      LDA #$0A
$62FC                A0 00      LDY #$00
$62FE                91 9D      STA ($9D),Y
$6300                C8         INY
$6301                A5 9F      LDA $9F
$6303                91 9D      STA ($9D),Y
$6305                C8         INY
$6306                A5 A0      LDA $A0
$6308                91 9D      STA ($9D),Y
$630A                A9 03      LDA #$03
$630C                10 4D      BPL $635B
$630E                A5 A1      LDA $A1
$6310                A6 A2      LDX $A2
$6312                85 9F      STA $9F
$6314                86 A0      STX $A0
$6316                4C 2A 63   JMP $632A
$6319                A0 60      LDY #$60
$631B                A2 9F      LDX #$9F
$631D                20 67 63   JSR $6367
$6320                4C 31 63   JMP $6331
$6323                A0 60      LDY #$60
$6325                A2 9F      LDX #$9F
$6327                20 67 63   JSR $6367
$632A                A0 68      LDY #$68
$632C                A2 A1      LDX #$A1
$632E                20 67 63   JSR $6367
$6331                A5 7D      LDA $7D
$6333                D0 16      BNE $634B
$6335                A5 9F      LDA $9F
$6337                A6 A0      LDX $A0
$6339                85 B3      STA $B3
$633B                86 B4      STX $B4
$633D                A5 A1      LDA $A1
$633F                A6 A2      LDX $A2
$6341                85 B5      STA $B5
$6343                86 B6      STX $B6
$6345                20 45 77   JSR LINE2D
$6348                4C 18 61   JMP NEXTOP
$634B                A9 06      LDA #$06
$634D                A0 00      LDY #$00
$634F                91 9D      STA ($9D),Y
$6351                B9 9F 00   LDA $009F,Y
$6354                C8         INY
$6355                C0 05      CPY #$05
$6357                D0 F6      BNE $634F
$6359                A9 05      LDA #$05
$635B                18         CLC
$635C                65 9D      ADC $9D
$635E                85 9D      STA $9D
$6360                90 02      BCC $6364
$6362                E6 9E      INC $9E
$6364                4C 18 61   JMP NEXTOP
$6367                86 A7      STX $A7
$6369                84 A8      STY $A8
$636B                B9 04 00   LDA $0004,Y
$636E                85 7A      STA $7A
$6370  PROJECT:      B9 05 00   LDA $0005,Y
$6373                85 7B      STA $7B
$6375                B6 00      LDX $00,Y
$6377                B9 01 00   LDA $0001,Y
$637A                20 DE 65   JSR DIV
$637D                A5 79      LDA $79
$637F                A2 1F      LDX #$1F
$6381                20 9D 65   JSR SCALE
$6384                18         CLC
$6385                69 20      ADC #$20
$6387                A4 A7      LDY $A7
$6389                99 00 00   STA $0000,Y
$638C                A4 A8      LDY $A8
$638E                B9 04 00   LDA $0004,Y
$6391                85 7A      STA $7A
$6393                B9 05 00   LDA $0005,Y
$6396                85 7B      STA $7B
$6398                B6 02      LDX $02,Y
$639A                B9 03 00   LDA $0003,Y
$639D                20 DE 65   JSR DIV
$63A0                A5 79      LDA $79
$63A2                A2 20      LDX #$20
$63A4                20 9D 65   JSR SCALE
$63A7                18         CLC
$63A8                69 C3      ADC #$C3
$63AA                A4 A7      LDY $A7
$63AC                99 01 00   STA $0001,Y
$63AF                60         RTS
$63B0  OP04:         C8         INY
$63B1                B1 9B      LDA ($9B),Y
$63B3                85 7C      STA $7C
$63B5  ADV2:         A9 02      LDA #$02
$63B7  ADV.A:        20 1F 62   JSR ADVANCE
$63BA                4C 18 61   JMP NEXTOP
$63BD  OP05:         C8         INY
$63BE                B1 9B      LDA ($9B),Y
$63C0                99 8F 00   STA $008F,Y
$63C3                C0 09      CPY #$09
$63C5                D0 F6      BNE OP05
$63C7                20 6E 66   JSR SETVIEW
$63CA                A9 0A      LDA #$0A
$63CC                D0 E9      BNE ADV.A
$63CE  OP06:         C8         INY
$63CF                B1 9B      LDA ($9B),Y
$63D1                99 B2 00   STA $00B2,Y
$63D4                C0 04      CPY #$04
$63D6                D0 F6      BNE OP06
$63D8                20 45 77   JSR LINE2D
$63DB                A9 05      LDA #$05
$63DD                D0 D8      BNE ADV.A
$63DF  OP07:         C8         INY
$63E0                B1 9B      LDA ($9B),Y
$63E2                8D E8 63   STA $63E8
$63E5                A9 00      LDA #$00
$63E7                8D 55 C0   STA $C055
$63EA                F0 C9      BEQ ADV2
$63EC  OP10:         C8         INY
$63ED                B1 9B      LDA ($9B),Y
$63EF                AA         TAX
$63F0                C8         INY
$63F1                B1 9B      LDA ($9B),Y
$63F3                A8         TAY
$63F4                20 1C 77   JSR PLOT2D
$63F7                A9 03      LDA #$03
$63F9                D0 BC      BNE ADV.A
$63FB  OP11:         C8         INY
$63FC                B1 9B      LDA ($9B),Y
$63FE                AA         TAX
$63FF                C8         INY
$6400                B1 9B      LDA ($9B),Y
$6402                85 9C      STA $9C
$6404                86 9B      STX $9B
$6406                4C 1C 61   JMP NEXTOP.Y0
$6409  OP13:         A9 FF      LDA #$FF
$640B                85 7D      STA $7D
$640D                C8         INY
$640E                B1 9B      LDA ($9B),Y
$6410                85 9D      STA $9D
$6412                C8         INY
$6413                B1 9B      LDA ($9B),Y
$6415                85 9E      STA $9E
$6417                4C F7 63   JMP $63F7
$641A  OP16:         A9 00      LDA #$00
$641C                8D 53 C0   STA $C053
$641F                8D 57 C0   STA $C057
$6422                8D 50 C0   STA $C050
$6425                8D 54 C0   STA $C054
$6428  OP17:         A9 01      LDA #$01
$642A                4C B7 63   JMP ADV.A
$642D  OP14:         C8         INY
$642E                B1 9B      LDA ($9B),Y
$6430                18         CLC
$6431                6A         ROR A
$6432                38         SEC
$6433                E9 01      SBC #$01
$6435                8D 80 63   STA $6380
$6438                C8         INY
$6439                B1 9B      LDA ($9B),Y
$643B                18         CLC
$643C                6A         ROR A
$643D                38         SEC
$643E                E9 01      SBC #$01
$6440                8D A3 63   STA $63A3
$6443                C8         INY
$6444                B1 9B      LDA ($9B),Y
$6446                8D 86 63   STA $6386
$6449                C8         INY
$644A                B1 9B      LDA ($9B),Y
$644C                8D A9 63   STA $63A9
$644F                4C DB 63   JMP $63DB
$6452  OP15:         C8         INY
$6453                B1 9B      LDA ($9B),Y
$6455                99 3F 61   STA $613F,Y
$6458                C0 06      CPY #$06
$645A                D0 F6      BNE OP15
$645C                A9 07      LDA #$07
$645E                4C B7 63   JMP ADV.A
$6461  MUL16:        85 A3      STA $A3
$6463                B5 00      LDA $00,X
$6465                85 78      STA $78
$6467                B5 01      LDA $01,X
$6469                85 79      STA $79
$646B                B9 00 00   LDA $0000,Y
$646E                85 7A      STA $7A
$6470                B9 01 00   LDA $0001,Y
$6473                85 7B      STA $7B
$6475                20 80 64   JSR MULCORE
$6478                A4 A3      LDY $A3
$647A                99 00 00   STA $0000,Y
$647D                96 01      STX $01,Y
$647F                60         RTS
$6480  MULCORE:      A5 78      LDA $78
$6482                05 79      ORA $79
$6484                F0 06      BEQ $648C
$6486                A5 7A      LDA $7A
$6488                05 7B      ORA $7B
$648A                D0 05      BNE $6491
$648C                A9 00      LDA #$00
$648E                A2 00      LDX #$00
$6490                60         RTS
$6491                A5 79      LDA $79
$6493                45 7B      EOR $7B
$6495                A8         TAY
$6496                A5 79      LDA $79
$6498                30 0E      BMI $64A8
$649A                A9 FF      LDA #$FF
$649C                45 78      EOR $78
$649E                85 78      STA $78
$64A0                A9 FF      LDA #$FF
$64A2                45 79      EOR $79
$64A4                85 79      STA $79
$64A6                30 08      BMI $64B0
$64A8                A5 78      LDA $78
$64AA                D0 02      BNE $64AE
$64AC                C6 79      DEC $79
$64AE                C6 78      DEC $78
$64B0                A5 7B      LDA $7B
$64B2                10 0D      BPL $64C1
$64B4                A9 00      LDA #$00
$64B6                38         SEC
$64B7                E5 7A      SBC $7A
$64B9                85 7A      STA $7A
$64BB                A9 00      LDA #$00
$64BD                E5 7B      SBC $7B
$64BF                85 7B      STA $7B
$64C1                46 78      LSR $78
$64C3                90 02      BCC $64C7
$64C5                A9 00      LDA #$00
$64C7                4A         LSR A
$64C8                66 78      ROR $78
$64CA                B0 02      BCS $64CE
$64CC                65 7B      ADC $7B
$64CE                4A         LSR A
$64CF                66 78      ROR $78
$64D1                B0 02      BCS $64D5
$64D3                65 7B      ADC $7B
$64D5                4A         LSR A
$64D6                66 78      ROR $78
$64D8                B0 02      BCS $64DC
$64DA                65 7B      ADC $7B
$64DC                4A         LSR A
$64DD                66 78      ROR $78
$64DF                B0 02      BCS $64E3
$64E1                65 7B      ADC $7B
$64E3                4A         LSR A
$64E4                66 78      ROR $78
$64E6                B0 02      BCS $64EA
$64E8                65 7B      ADC $7B
$64EA                4A         LSR A
$64EB                A2 00      LDX #$00
$64ED                86 A5      STX $A5
$64EF                46 78      LSR $78
$64F1                B0 0A      BCS $64FD
$64F3                AA         TAX
$64F4                A5 A5      LDA $A5
$64F6                65 7A      ADC $7A
$64F8                85 A5      STA $A5
$64FA                8A         TXA
$64FB                65 7B      ADC $7B
$64FD                4A         LSR A
$64FE                66 A5      ROR $A5
$6500                46 78      LSR $78
$6502                B0 0A      BCS $650E
$6504                AA         TAX
$6505                A5 A5      LDA $A5
$6507                65 7A      ADC $7A
$6509                85 A5      STA $A5
$650B                8A         TXA
$650C                65 7B      ADC $7B
$650E                4A         LSR A
$650F                66 A5      ROR $A5
$6511                46 79      LSR $79
$6513                B0 0A      BCS $651F
$6515                AA         TAX
$6516                A5 A5      LDA $A5
$6518                65 7A      ADC $7A
$651A                85 A5      STA $A5
$651C                8A         TXA
$651D                65 7B      ADC $7B
$651F                4A         LSR A
$6520                66 A5      ROR $A5
$6522                46 79      LSR $79
$6524                B0 0A      BCS $6530
$6526                AA         TAX
$6527                A5 A5      LDA $A5
$6529                65 7A      ADC $7A
$652B                85 A5      STA $A5
$652D                8A         TXA
$652E                65 7B      ADC $7B
$6530                4A         LSR A
$6531                66 A5      ROR $A5
$6533                46 79      LSR $79
$6535                B0 0A      BCS $6541
$6537                AA         TAX
$6538                A5 A5      LDA $A5
$653A                65 7A      ADC $7A
$653C                85 A5      STA $A5
$653E                8A         TXA
$653F                65 7B      ADC $7B
$6541                4A         LSR A
$6542                66 A5      ROR $A5
$6544                46 79      LSR $79
$6546                B0 0A      BCS $6552
$6548                AA         TAX
$6549                A5 A5      LDA $A5
$654B                65 7A      ADC $7A
$654D                85 A5      STA $A5
$654F                8A         TXA
$6550                65 7B      ADC $7B
$6552                4A         LSR A
$6553                66 A5      ROR $A5
$6555                46 79      LSR $79
$6557                B0 0A      BCS $6563
$6559                AA         TAX
$655A                A5 A5      LDA $A5
$655C                65 7A      ADC $7A
$655E                85 A5      STA $A5
$6560                8A         TXA
$6561                65 7B      ADC $7B
$6563                4A         LSR A
$6564                66 A5      ROR $A5
$6566                46 79      LSR $79
$6568                B0 0A      BCS $6574
$656A                AA         TAX
$656B                A5 A5      LDA $A5
$656D                65 7A      ADC $7A
$656F                85 A5      STA $A5
$6571                8A         TXA
$6572                65 7B      ADC $7B
$6574                4A         LSR A
$6575                66 A5      ROR $A5
$6577                46 79      LSR $79
$6579                B0 0A      BCS $6585
$657B                AA         TAX
$657C                A5 A5      LDA $A5
$657E                65 7A      ADC $7A
$6580                85 A5      STA $A5
$6582                8A         TXA
$6583                65 7B      ADC $7B
$6585                4A         LSR A
$6586                66 A5      ROR $A5
$6588                C0 00      CPY #$00
$658A                10 0D      BPL $6599
$658C                85 A6      STA $A6
$658E                A9 00      LDA #$00
$6590                38         SEC
$6591                E5 A5      SBC $A5
$6593                85 A5      STA $A5
$6595                A9 00      LDA #$00
$6597                E5 A6      SBC $A6
$6599                AA         TAX
$659A                A5 A5      LDA $A5
$659C                60         RTS
$659D  SCALE:        49 FF      EOR #$FF
$659F                85 78      STA $78
$65A1                86 7B      STX $7B
$65A3                A9 00      LDA #$00
$65A5                66 78      ROR $78
$65A7                B0 01      BCS $65AA
$65A9                8A         TXA
$65AA                4A         LSR A
$65AB                66 78      ROR $78
$65AD                B0 02      BCS $65B1
$65AF                65 7B      ADC $7B
$65B1                4A         LSR A
$65B2                66 78      ROR $78
$65B4                B0 02      BCS $65B8
$65B6                65 7B      ADC $7B
$65B8                4A         LSR A
$65B9                66 78      ROR $78
$65BB                B0 02      BCS $65BF
$65BD                65 7B      ADC $7B
$65BF                4A         LSR A
$65C0                66 78      ROR $78
$65C2                B0 02      BCS $65C6
$65C4                65 7B      ADC $7B
$65C6                4A         LSR A
$65C7                66 78      ROR $78
$65C9                B0 02      BCS $65CD
$65CB                65 7B      ADC $7B
$65CD                4A         LSR A
$65CE                66 78      ROR $78
$65D0                B0 02      BCS $65D4
$65D2                65 7B      ADC $7B
$65D4                4A         LSR A
$65D5                66 78      ROR $78
$65D7                B0 04      BCS $65DD
$65D9                38         SEC
$65DA                38         SEC
$65DB                E5 7B      SBC $7B
$65DD                60         RTS
$65DE  DIV:          09 00      ORA #$00
$65E0                30 0C      BMI $65EE
$65E2                A4 7B      LDY $7B
$65E4                30 02      BMI $65E8
$65E6                10 44      BPL $662C
$65E8                20 0B 66   JSR $660B
$65EB                4C 1B 66   JMP $661B
$65EE                20 FD 65   JSR $65FD
$65F1                A4 7B      LDY $7B
$65F3                30 02      BMI $65F7
$65F5                10 24      BPL $661B
$65F7                20 0B 66   JSR $660B
$65FA                4C 2C 66   JMP $662C
$65FD                A8         TAY
$65FE                8A         TXA
$65FF                49 FF      EOR #$FF
$6601                18         CLC
$6602                69 01      ADC #$01
$6604                AA         TAX
$6605                98         TYA
$6606                49 FF      EOR #$FF
$6608                69 00      ADC #$00
$660A                60         RTS
$660B                A8         TAY
$660C                A9 00      LDA #$00
$660E                38         SEC
$660F                E5 7A      SBC $7A
$6611                85 7A      STA $7A
$6613                A9 00      LDA #$00
$6615                E5 7B      SBC $7B
$6617                85 7B      STA $7B
$6619                98         TYA
$661A                60         RTS
$661B                20 2C 66   JSR $662C
$661E                A9 00      LDA #$00
$6620                38         SEC
$6621                E5 78      SBC $78
$6623                85 78      STA $78
$6625                A9 00      LDA #$00
$6627                E5 79      SBC $79
$6629                85 79      STA $79
$662B                60         RTS
$662C                A0 0F      LDY #$0F
$662E                86 A5      STX $A5
$6630                AA         TAX
$6631                A5 A5      LDA $A5
$6633                38         SEC
$6634                E5 7A      SBC $7A
$6636                85 A5      STA $A5
$6638                8A         TXA
$6639                E5 7B      SBC $7B
$663B                30 0D      BMI $664A
$663D                38         SEC
$663E                26 78      ROL $78
$6640                26 79      ROL $79
$6642                06 A5      ASL $A5
$6644                2A         ROL A
$6645                88         DEY
$6646                D0 E8      BNE $6630
$6648                F0 19      BEQ $6663
$664A                06 78      ASL $78
$664C                26 79      ROL $79
$664E                06 A5      ASL $A5
$6650                2A         ROL A
$6651                88         DEY
$6652                F0 0F      BEQ $6663
$6654                AA         TAX
$6655                A5 A5      LDA $A5
$6657                18         CLC
$6658                65 7A      ADC $7A
$665A                85 A5      STA $A5
$665C                8A         TXA
$665D                65 7B      ADC $7B
$665F                30 E9      BMI $664A
$6661                10 DA      BPL $663D
$6663                06 78      ASL $78
$6665                26 79      ROL $79
$6667                10 04      BPL $666D
$6669                C6 78      DEC $78
$666B                C6 79      DEC $79
$666D                60         RTS
$666E  SETVIEW:      A5 96      LDA $96
$6670                20 C8 61   JSR SIN.A
$6673                85 60      STA $60
$6675                86 61      STX $61
$6677                A5 97      LDA $97
$6679                20 C8 61   JSR SIN.A
$667C                85 62      STA $62
$667E                86 63      STX $63
$6680                A5 98      LDA $98
$6682                20 C8 61   JSR SIN.A
$6685                85 64      STA $64
$6687                86 65      STX $65
$6689                A5 96      LDA $96
$668B                20 CB 61   JSR COS.A
$668E                85 66      STA $66
$6690                86 67      STX $67
$6692                A5 97      LDA $97
$6694                20 CB 61   JSR COS.A
$6697                85 68      STA $68
$6699                86 69      STX $69
$669B                A5 98      LDA $98
$669D                20 CB 61   JSR COS.A
$66A0                85 6A      STA $6A
$66A2                86 6B      STX $6B
$66A4                A2 6A      LDX #$6A
$66A6                A0 68      LDY #$68
$66A8                A9 6C      LDA #$6C
$66AA                20 61 64   JSR MUL16
$66AD                A2 64      LDX #$64
$66AF                A0 62      LDY #$62
$66B1                A9 6E      LDA #$6E
$66B3                20 61 64   JSR MUL16
$66B6                A2 6A      LDX #$6A
$66B8                A0 62      LDY #$62
$66BA                A9 70      LDA #$70
$66BC                20 61 64   JSR MUL16
$66BF                A2 64      LDX #$64
$66C1                A0 68      LDY #$68
$66C3                A9 72      LDA #$72
$66C5                20 61 64   JSR MUL16
$66C8                A2 60      LDX #$60
$66CA                A0 6E      LDY #$6E
$66CC                A9 74      LDA #$74
$66CE                20 61 64   JSR MUL16
$66D1                A2 60      LDX #$60
$66D3                A0 72      LDY #$72
$66D5                A9 76      LDA #$76
$66D7                20 61 64   JSR MUL16
$66DA                A2 70      LDX #$70
$66DC                A0 60      LDY #$60
$66DE                A9 B3      LDA #$B3
$66E0                20 61 64   JSR MUL16
$66E3                A2 60      LDX #$60
$66E5                A0 6C      LDY #$6C
$66E7                A9 B5      LDA #$B5
$66E9                20 61 64   JSR MUL16
$66EC                18         CLC
$66ED                A5 6C      LDA $6C
$66EF                65 74      ADC $74
$66F1                85 7E      STA $7E
$66F3                A5 6D      LDA $6D
$66F5                65 75      ADC $75
$66F7                85 7F      STA $7F
$66F9                38         SEC
$66FA                A5 76      LDA $76
$66FC                E5 70      SBC $70
$66FE                85 80      STA $80
$6700                A5 77      LDA $77
$6702                E5 71      SBC $71
$6704                85 81      STA $81
$6706                A2 64      LDX #$64
$6708                A0 66      LDY #$66
$670A                A9 82      LDA #$82
$670C                20 61 64   JSR MUL16
$670F                A2 62      LDX #$62
$6711                A0 66      LDY #$66
$6713                A9 84      LDA #$84
$6715                20 61 64   JSR MUL16
$6718                A2 66      LDX #$66
$671A                A0 68      LDY #$68
$671C                A9 86      LDA #$86
$671E                20 61 64   JSR MUL16
$6721                A9 00      LDA #$00
$6723                38         SEC
$6724                E5 60      SBC $60
$6726                85 88      STA $88
$6728                A9 00      LDA #$00
$672A                E5 61      SBC $61
$672C                85 89      STA $89
$672E                38         SEC
$672F                A5 B3      LDA $B3
$6731                E5 72      SBC $72
$6733                85 8A      STA $8A
$6735                A5 B4      LDA $B4
$6737                E5 73      SBC $73
$6739                85 8B      STA $8B
$673B                18         CLC
$673C                A5 6E      LDA $6E
$673E                65 B5      ADC $B5
$6740                85 8C      STA $8C
$6742                A5 6F      LDA $6F
$6744                65 B6      ADC $B6
$6746                85 8D      STA $8D
$6748                A2 6A      LDX #$6A
$674A                A0 66      LDY #$66
$674C                A9 8E      LDA #$8E
$674E                20 61 64   JSR MUL16
$6751                AE 41 61   LDX $6141
$6754                E0 7F      CPX #$7F
$6756                D0 07      BNE $675F
$6758                AD 40 61   LDA $6140
$675B                C9 FF      CMP #$FF
$675D                F0 45      BEQ $67A4
$675F                85 78      STA $78
$6761                86 79      STX $79
$6763                A5 7E      LDA $7E
$6765                A6 7F      LDX $7F
$6767                85 7A      STA $7A
$6769                86 7B      STX $7B
$676B                20 80 64   JSR MULCORE
$676E                85 7E      STA $7E
$6770                86 7F      STX $7F
$6772                A5 84      LDA $84
$6774                A6 85      LDX $85
$6776                85 78      STA $78
$6778                86 79      STX $79
$677A                AD 40 61   LDA $6140
$677D                AE 41 61   LDX $6141
$6780                85 7A      STA $7A
$6782                86 7B      STX $7B
$6784                20 80 64   JSR MULCORE
$6787                85 84      STA $84
$6789                86 85      STX $85
$678B                A5 8A      LDA $8A
$678D                A6 8B      LDX $8B
$678F                85 78      STA $78
$6791                86 79      STX $79
$6793                AD 40 61   LDA $6140
$6796                AE 41 61   LDX $6141
$6799                85 7A      STA $7A
$679B                86 7B      STX $7B
$679D                20 80 64   JSR MULCORE
$67A0                85 8A      STA $8A
$67A2                86 8B      STX $8B
$67A4                AE 43 61   LDX $6143
$67A7                E0 7F      CPX #$7F
$67A9                D0 07      BNE $67B2
$67AB                AD 42 61   LDA $6142
$67AE                C9 FF      CMP #$FF
$67B0                F0 45      BEQ $67F7
$67B2                85 78      STA $78
$67B4                86 79      STX $79
$67B6                A5 80      LDA $80
$67B8                A6 81      LDX $81
$67BA                85 7A      STA $7A
$67BC                86 7B      STX $7B
$67BE                20 80 64   JSR MULCORE
$67C1                85 80      STA $80
$67C3                86 81      STX $81
$67C5                AD 42 61   LDA $6142
$67C8                AE 43 61   LDX $6143
$67CB                85 78      STA $78
$67CD                86 79      STX $79
$67CF                A5 86      LDA $86
$67D1                A6 87      LDX $87
$67D3                85 7A      STA $7A
$67D5                86 7B      STX $7B
$67D7                20 80 64   JSR MULCORE
$67DA                85 86      STA $86
$67DC                86 87      STX $87
$67DE                AD 42 61   LDA $6142
$67E1                AE 43 61   LDX $6143
$67E4                85 78      STA $78
$67E6                86 79      STX $79
$67E8                A5 8C      LDA $8C
$67EA                A6 8D      LDX $8D
$67EC                85 7A      STA $7A
$67EE                86 7B      STX $7B
$67F0                20 80 64   JSR MULCORE
$67F3                85 8C      STA $8C
$67F5                86 8D      STX $8D
$67F7                AE 45 61   LDX $6145
$67FA                E0 7F      CPX #$7F
$67FC                D0 07      BNE $6805
$67FE                AD 44 61   LDA $6144
$6801                C9 FF      CMP #$FF
$6803                F0 45      BEQ $684A
$6805                85 78      STA $78
$6807                86 79      STX $79
$6809                A5 82      LDA $82
$680B                A6 83      LDX $83
$680D                85 7A      STA $7A
$680F                86 7B      STX $7B
$6811                20 80 64   JSR MULCORE
$6814                85 82      STA $82
$6816                86 83      STX $83
$6818                AD 44 61   LDA $6144
$681B                AE 45 61   LDX $6145
$681E                85 78      STA $78
$6820                86 79      STX $79
$6822                A5 88      LDA $88
$6824                A6 89      LDX $89
$6826                85 7A      STA $7A
$6828                86 7B      STX $7B
$682A                20 80 64   JSR MULCORE
$682D                85 88      STA $88
$682F                86 89      STX $89
$6831                AD 44 61   LDA $6144
$6834                AE 45 61   LDX $6145
$6837                85 78      STA $78
$6839                86 79      STX $79
$683B                A5 8E      LDA $8E
$683D                A6 8F      LDX $8F
$683F                85 7A      STA $7A
$6841                86 7B      STX $7B
$6843                20 80 64   JSR MULCORE
$6846                85 8E      STA $8E
$6848                86 8F      STX $8F
$684A                60         RTS
$684B                .byte $03, $01
$684D  FETCHPT:      84 B2      STY $B2
$684F                A0 01      LDY #$01
$6851                B1 9B      LDA ($9B),Y
$6853                C8         INY
$6854                38         SEC
$6855                E5 90      SBC $90
$6857                85 AB      STA $AB
$6859                B1 9B      LDA ($9B),Y
$685B                C8         INY
$685C                E5 91      SBC $91
$685E                50 03      BVC $6863
$6860                4C 97 69   JMP $6997
$6863                85 AC      STA $AC
$6865                B1 9B      LDA ($9B),Y
$6867                C8         INY
$6868                38         SEC
$6869                E5 92      SBC $92
$686B                85 AD      STA $AD
$686D                B1 9B      LDA ($9B),Y
$686F                C8         INY
$6870                E5 93      SBC $93
$6872                50 03      BVC $6877
$6874                4C CD 69   JMP $69CD
$6877                85 AE      STA $AE
$6879                B1 9B      LDA ($9B),Y
$687B                C8         INY
$687C                38         SEC
$687D                E5 94      SBC $94
$687F                85 AF      STA $AF
$6881                B1 9B      LDA ($9B),Y
$6883                C8         INY
$6884                E5 95      SBC $95
$6886                50 03      BVC $688B
$6888                4C DC 69   JMP $69DC
$688B                85 B0      STA $B0
$688D                A5 AC      LDA $AC
$688F                29 C0      AND #$C0
$6891                F0 04      BEQ $6897
$6893                C9 C0      CMP #$C0
$6895                D0 14      BNE $68AB
$6897                A5 AE      LDA $AE
$6899                29 C0      AND #$C0
$689B                F0 04      BEQ $68A1
$689D                C9 C0      CMP #$C0
$689F                D0 0A      BNE $68AB
$68A1                A5 B0      LDA $B0
$68A3                29 C0      AND #$C0
$68A5                F0 1E      BEQ $68C5
$68A7                C9 C0      CMP #$C0
$68A9                F0 1A      BEQ $68C5
$68AB                AD 1E 62   LDA MODE29
$68AE                D0 15      BNE $68C5
$68B0                A5 AC      LDA $AC
$68B2                2A         ROL A
$68B3                66 AC      ROR $AC
$68B5                66 AB      ROR $AB
$68B7                A5 AE      LDA $AE
$68B9                2A         ROL A
$68BA                66 AE      ROR $AE
$68BC                66 AD      ROR $AD
$68BE                A5 B0      LDA $B0
$68C0                2A         ROL A
$68C1                66 B0      ROR $B0
$68C3                66 AF      ROR $AF
$68C5                A9 00      LDA #$00
$68C7                8D 4B 68   STA $684B
$68CA                8D 4C 68   STA $684C
$68CD                A2 AB      LDX #$AB
$68CF                A0 7E      LDY #$7E
$68D1                A9 A7      LDA #$A7
$68D3                20 61 64   JSR MUL16
$68D6                A2 AD      LDX #$AD
$68D8                A0 84      LDY #$84
$68DA                A9 A9      LDA #$A9
$68DC                20 61 64   JSR MUL16
$68DF                A5 AF      LDA $AF
$68E1                A6 B0      LDX $B0
$68E3                85 78      STA $78
$68E5                86 79      STX $79
$68E7                A5 8A      LDA $8A
$68E9                A6 8B      LDX $8B
$68EB                85 7A      STA $7A
$68ED                86 7B      STX $7B
$68EF                20 80 64   JSR MULCORE
$68F2                20 F2 69   JSR $69F2
$68F5                A2 AB      LDX #$AB
$68F7                A0 80      LDY #$80
$68F9                A9 A7      LDA #$A7
$68FB                20 61 64   JSR MUL16
$68FE                A2 AD      LDX #$AD
$6900                A0 86      LDY #$86
$6902                A9 A9      LDA #$A9
$6904                20 61 64   JSR MUL16
$6907                A5 AF      LDA $AF
$6909                A6 B0      LDX $B0
$690B                85 78      STA $78
$690D                86 79      STX $79
$690F                A5 8C      LDA $8C
$6911                A6 8D      LDX $8D
$6913                85 7A      STA $7A
$6915                86 7B      STX $7B
$6917                20 80 64   JSR MULCORE
$691A                20 F2 69   JSR $69F2
$691D                A2 AB      LDX #$AB
$691F                A0 82      LDY #$82
$6921                A9 A7      LDA #$A7
$6923                20 61 64   JSR MUL16
$6926                A2 AD      LDX #$AD
$6928                A0 88      LDY #$88
$692A                A9 A9      LDA #$A9
$692C                20 61 64   JSR MUL16
$692F                A5 AF      LDA $AF
$6931                A6 B0      LDX $B0
$6933                85 78      STA $78
$6935                86 79      STX $79
$6937                A5 8E      LDA $8E
$6939                A6 8F      LDX $8F
$693B                85 7A      STA $7A
$693D                86 7B      STX $7B
$693F                20 80 64   JSR MULCORE
$6942                20 F2 69   JSR $69F2
$6945                AD 1E 62   LDA MODE29
$6948                F0 03      BEQ $694D
$694A                20 F0 71   JSR $71F0
$694D                A6 B2      LDX $B2
$694F                AD 4C 68   LDA $684C
$6952                F0 16      BEQ $696A
$6954                B5 FF      LDA $FF,X
$6956                2A         ROL A
$6957                76 FF      ROR $FF,X
$6959                76 FE      ROR $FE,X
$695B                B5 FD      LDA $FD,X
$695D                2A         ROL A
$695E                76 FD      ROR $FD,X
$6960                76 FC      ROR $FC,X
$6962                B5 FB      LDA $FB,X
$6964                2A         ROL A
$6965                76 FB      ROR $FB,X
$6967                76 FA      ROR $FA,X
$6969                60         RTS
$696A                AD 4B 68   LDA $684B
$696D                D0 27      BNE $6996
$696F                B5 FE      LDA $FE,X
$6971                0A         ASL A
$6972                36 FF      ROL $FF,X
$6974                0A         ASL A
$6975                36 FF      ROL $FF,X
$6977                0A         ASL A
$6978                36 FF      ROL $FF,X
$697A                95 FE      STA $FE,X
$697C                B5 FC      LDA $FC,X
$697E                0A         ASL A
$697F                36 FD      ROL $FD,X
$6981                0A         ASL A
$6982                36 FD      ROL $FD,X
$6984                0A         ASL A
$6985                36 FD      ROL $FD,X
$6987                95 FC      STA $FC,X
$6989                B5 FA      LDA $FA,X
$698B                0A         ASL A
$698C                36 FB      ROL $FB,X
$698E                0A         ASL A
$698F                36 FB      ROL $FB,X
$6991                0A         ASL A
$6992                36 FB      ROL $FB,X
$6994                95 FA      STA $FA,X
$6996                60         RTS
$6997                6A         ROR A
$6998                85 AC      STA $AC
$699A                66 AB      ROR $AB
$699C                B1 9B      LDA ($9B),Y
$699E                C8         INY
$699F                38         SEC
$69A0                E5 92      SBC $92
$69A2                85 AD      STA $AD
$69A4                B1 9B      LDA ($9B),Y
$69A6                C8         INY
$69A7                E5 93      SBC $93
$69A9                70 04      BVS $69AF
$69AB                85 AE      STA $AE
$69AD                26 AE      ROL $AE
$69AF                6A         ROR A
$69B0                85 AE      STA $AE
$69B2                66 AD      ROR $AD
$69B4                B1 9B      LDA ($9B),Y
$69B6                C8         INY
$69B7                38         SEC
$69B8                E5 94      SBC $94
$69BA                85 AF      STA $AF
$69BC                B1 9B      LDA ($9B),Y
$69BE                C8         INY
$69BF                E5 95      SBC $95
$69C1                70 02      BVS $69C5
$69C3                C9 80      CMP #$80
$69C5                6A         ROR A
$69C6                85 B0      STA $B0
$69C8                66 AF      ROR $AF
$69CA                4C 8D 68   JMP $688D
$69CD                6A         ROR A
$69CE                85 AE      STA $AE
$69D0                66 AD      ROR $AD
$69D2                A5 AC      LDA $AC
$69D4                2A         ROL A
$69D5                66 AC      ROR $AC
$69D7                66 AB      ROR $AB
$69D9                4C B4 69   JMP $69B4
$69DC                6A         ROR A
$69DD                85 B0      STA $B0
$69DF                66 AF      ROR $AF
$69E1                A5 AE      LDA $AE
$69E3                2A         ROL A
$69E4                66 AE      ROR $AE
$69E6                66 AD      ROR $AD
$69E8                A5 AC      LDA $AC
$69EA                2A         ROL A
$69EB                66 AC      ROR $AC
$69ED                66 AB      ROR $AB
$69EF                4C 8D 68   JMP $688D
$69F2                18         CLC
$69F3                65 A7      ADC $A7
$69F5                A8         TAY
$69F6                8A         TXA
$69F7                65 A8      ADC $A8
$69F9                AA         TAX
$69FA                98         TYA
$69FB                18         CLC
$69FC                65 A9      ADC $A9
$69FE                A8         TAY
$69FF                8A         TXA
$6A00                65 AA      ADC $AA
$6A02                A6 B2      LDX $B2
$6A04                95 01      STA $01,X
$6A06                94 00      STY $00,X
$6A08                E6 B2      INC $B2
$6A0A                E6 B2      INC $B2
$6A0C                AA         TAX
$6A0D                F0 12      BEQ $6A21
$6A0F                C9 FF      CMP #$FF
$6A11                F0 0E      BEQ $6A21
$6A13                EE 4B 68   INC $684B
$6A16                29 E0      AND #$E0
$6A18                F0 07      BEQ $6A21
$6A1A                C9 E0      CMP #$E0
$6A1C                F0 03      BEQ $6A21
$6A1E                EE 4C 68   INC $684C
$6A21                60         RTS
$6A22  OUTCODE1:     A2 00      LDX #$00
$6A24                A5 60      LDA $60
$6A26                18         CLC
$6A27                65 64      ADC $64
$6A29                A5 61      LDA $61
$6A2B                65 65      ADC $65
$6A2D                30 04      BMI $6A33
$6A2F                50 06      BVC $6A37
$6A31                70 02      BVS $6A35
$6A33                70 02      BVS $6A37
$6A35                A2 40      LDX #$40
$6A37                A5 64      LDA $64
$6A39                38         SEC
$6A3A                E5 60      SBC $60
$6A3C                A5 65      LDA $65
$6A3E                E5 61      SBC $61
$6A40                30 04      BMI $6A46
$6A42                50 08      BVC $6A4C
$6A44                70 02      BVS $6A48
$6A46                70 04      BVS $6A4C
$6A48                8A         TXA
$6A49                09 20      ORA #$20
$6A4B                AA         TAX
$6A4C                A5 62      LDA $62
$6A4E                18         CLC
$6A4F                65 64      ADC $64
$6A51                A5 63      LDA $63
$6A53                65 65      ADC $65
$6A55                30 04      BMI $6A5B
$6A57                50 08      BVC $6A61
$6A59                70 02      BVS $6A5D
$6A5B                70 04      BVS $6A61
$6A5D                8A         TXA
$6A5E                09 10      ORA #$10
$6A60                AA         TAX
$6A61                A5 64      LDA $64
$6A63                38         SEC
$6A64                E5 62      SBC $62
$6A66                A5 65      LDA $65
$6A68                E5 63      SBC $63
$6A6A                30 04      BMI $6A70
$6A6C                50 0A      BVC $6A78
$6A6E                70 02      BVS $6A72
$6A70                70 06      BVS $6A78
$6A72                8A         TXA
$6A73                09 08      ORA #$08
$6A75                85 66      STA $66
$6A77                60         RTS
$6A78                86 66      STX $66
$6A7A                60         RTS
$6A7B  OUTCODE2:     A2 00      LDX #$00
$6A7D                A5 68      LDA $68
$6A7F                18         CLC
$6A80                65 6C      ADC $6C
$6A82                A5 69      LDA $69
$6A84                65 6D      ADC $6D
$6A86                30 04      BMI $6A8C
$6A88                50 06      BVC $6A90
$6A8A                70 02      BVS $6A8E
$6A8C                70 02      BVS $6A90
$6A8E                A2 40      LDX #$40
$6A90                A5 6C      LDA $6C
$6A92                38         SEC
$6A93                E5 68      SBC $68
$6A95                A5 6D      LDA $6D
$6A97                E5 69      SBC $69
$6A99                30 04      BMI $6A9F
$6A9B                50 08      BVC $6AA5
$6A9D                70 02      BVS $6AA1
$6A9F                70 04      BVS $6AA5
$6AA1                8A         TXA
$6AA2                09 20      ORA #$20
$6AA4                AA         TAX
$6AA5                A5 6A      LDA $6A
$6AA7                18         CLC
$6AA8                65 6C      ADC $6C
$6AAA                A5 6B      LDA $6B
$6AAC                65 6D      ADC $6D
$6AAE                30 04      BMI $6AB4
$6AB0                50 08      BVC $6ABA
$6AB2                70 02      BVS $6AB6
$6AB4                70 04      BVS $6ABA
$6AB6                8A         TXA
$6AB7                09 10      ORA #$10
$6AB9                AA         TAX
$6ABA                A5 6C      LDA $6C
$6ABC                38         SEC
$6ABD                E5 6A      SBC $6A
$6ABF                A5 6D      LDA $6D
$6AC1                E5 6B      SBC $6B
$6AC3                30 04      BMI $6AC9
$6AC5                50 0A      BVC $6AD1
$6AC7                70 02      BVS $6ACB
$6AC9                70 06      BVS $6AD1
$6ACB                8A         TXA
$6ACC                09 08      ORA #$08
$6ACE                85 6E      STA $6E
$6AD0                60         RTS
$6AD1                86 6E      STX $6E
$6AD3                60         RTS
$6AD4  CLIP1:        20 DE 6A   JSR $6ADE
$6AD7                20 EE 6A   JSR CLIP2
$6ADA                20 DE 6A   JSR $6ADE
$6ADD                60         RTS
$6ADE                A0 08      LDY #$08
$6AE0                B9 5F 00   LDA $005F,Y
$6AE3                B6 67      LDX $67,Y
$6AE5                99 67 00   STA $0067,Y
$6AE8                96 5F      STX $5F,Y
$6AEA                88         DEY
$6AEB                D0 F3      BNE $6AE0
$6AED                60         RTS
$6AEE  CLIP2:        A5 6E      LDA $6E
$6AF0                29 BF      AND #$BF
$6AF2                F0 0A      BEQ $6AFE
$6AF4                29 DF      AND #$DF
$6AF6                F0 09      BEQ $6B01
$6AF8                29 EF      AND #$EF
$6AFA                F0 08      BEQ $6B04
$6AFC                D0 09      BNE $6B07
$6AFE                4C 82 6C   JMP $6C82
$6B01                4C 07 6C   JMP $6C07
$6B04                4C 82 6B   JMP $6B82
$6B07                38         SEC
$6B08                A5 64      LDA $64
$6B0A                E5 6C      SBC $6C
$6B0C                85 7A      STA $7A
$6B0E                A5 65      LDA $65
$6B10                E5 6D      SBC $6D
$6B12                85 7B      STA $7B
$6B14                A5 62      LDA $62
$6B16                38         SEC
$6B17                E5 6A      SBC $6A
$6B19                AA         TAX
$6B1A                A5 63      LDA $63
$6B1C                E5 6B      SBC $6B
$6B1E                A8         TAY
$6B1F                8A         TXA
$6B20                38         SEC
$6B21                E5 7A      SBC $7A
$6B23                85 7A      STA $7A
$6B25                98         TYA
$6B26                E5 7B      SBC $7B
$6B28                85 7B      STA $7B
$6B2A                A5 6C      LDA $6C
$6B2C                38         SEC
$6B2D                E5 6A      SBC $6A
$6B2F                AA         TAX
$6B30                A5 6D      LDA $6D
$6B32                E5 6B      SBC $6B
$6B34                20 DE 65   JSR DIV
$6B37                38         SEC
$6B38                A5 60      LDA $60
$6B3A                E5 68      SBC $68
$6B3C                85 7A      STA $7A
$6B3E                A5 61      LDA $61
$6B40                E5 69      SBC $69
$6B42                85 7B      STA $7B
$6B44                A5 78      LDA $78
$6B46                A6 79      LDX $79
$6B48                85 A7      STA $A7
$6B4A                86 A8      STX $A8
$6B4C                20 80 64   JSR MULCORE
$6B4F                18         CLC
$6B50                65 68      ADC $68
$6B52                85 68      STA $68
$6B54                8A         TXA
$6B55                65 69      ADC $69
$6B57                85 69      STA $69
$6B59                38         SEC
$6B5A                A5 64      LDA $64
$6B5C                E5 6C      SBC $6C
$6B5E                85 7A      STA $7A
$6B60                A5 65      LDA $65
$6B62                E5 6D      SBC $6D
$6B64                85 7B      STA $7B
$6B66                A5 A7      LDA $A7
$6B68                A6 A8      LDX $A8
$6B6A                85 78      STA $78
$6B6C                86 79      STX $79
$6B6E                20 80 64   JSR MULCORE
$6B71                18         CLC
$6B72                65 6C      ADC $6C
$6B74                85 6C      STA $6C
$6B76                85 6A      STA $6A
$6B78                8A         TXA
$6B79                65 6D      ADC $6D
$6B7B                85 6D      STA $6D
$6B7D                85 6B      STA $6B
$6B7F                4C 7B 6A   JMP OUTCODE2
$6B82                38         SEC
$6B83                A5 64      LDA $64
$6B85                E5 6C      SBC $6C
$6B87                85 7A      STA $7A
$6B89                A5 65      LDA $65
$6B8B                E5 6D      SBC $6D
$6B8D                85 7B      STA $7B
$6B8F                A5 6A      LDA $6A
$6B91                38         SEC
$6B92                E5 62      SBC $62
$6B94                AA         TAX
$6B95                A5 6B      LDA $6B
$6B97                E5 63      SBC $63
$6B99                A8         TAY
$6B9A                8A         TXA
$6B9B                38         SEC
$6B9C                E5 7A      SBC $7A
$6B9E                85 7A      STA $7A
$6BA0                98         TYA
$6BA1                E5 7B      SBC $7B
$6BA3                85 7B      STA $7B
$6BA5                A5 6C      LDA $6C
$6BA7                18         CLC
$6BA8                65 6A      ADC $6A
$6BAA                AA         TAX
$6BAB                A5 6D      LDA $6D
$6BAD                65 6B      ADC $6B
$6BAF                20 DE 65   JSR DIV
$6BB2                38         SEC
$6BB3                A5 60      LDA $60
$6BB5                E5 68      SBC $68
$6BB7                85 7A      STA $7A
$6BB9                A5 61      LDA $61
$6BBB                E5 69      SBC $69
$6BBD                85 7B      STA $7B
$6BBF                A5 78      LDA $78
$6BC1                A6 79      LDX $79
$6BC3                85 A7      STA $A7
$6BC5                86 A8      STX $A8
$6BC7                20 80 64   JSR MULCORE
$6BCA                18         CLC
$6BCB                65 68      ADC $68
$6BCD                85 68      STA $68
$6BCF                8A         TXA
$6BD0                65 69      ADC $69
$6BD2                85 69      STA $69
$6BD4                38         SEC
$6BD5                A5 64      LDA $64
$6BD7                E5 6C      SBC $6C
$6BD9                85 7A      STA $7A
$6BDB                A5 65      LDA $65
$6BDD                E5 6D      SBC $6D
$6BDF                85 7B      STA $7B
$6BE1                A5 A7      LDA $A7
$6BE3                A6 A8      LDX $A8
$6BE5                85 78      STA $78
$6BE7                86 79      STX $79
$6BE9                20 80 64   JSR MULCORE
$6BEC                18         CLC
$6BED                65 6C      ADC $6C
$6BEF                85 6C      STA $6C
$6BF1                49 FF      EOR #$FF
$6BF3                85 6A      STA $6A
$6BF5                8A         TXA
$6BF6                65 6D      ADC $6D
$6BF8                85 6D      STA $6D
$6BFA                49 FF      EOR #$FF
$6BFC                85 6B      STA $6B
$6BFE                E6 6A      INC $6A
$6C00                D0 02      BNE $6C04
$6C02                E6 6B      INC $6B
$6C04                4C 7B 6A   JMP OUTCODE2
$6C07                38         SEC
$6C08                A5 64      LDA $64
$6C0A                E5 6C      SBC $6C
$6C0C                85 7A      STA $7A
$6C0E                A5 65      LDA $65
$6C10                E5 6D      SBC $6D
$6C12                85 7B      STA $7B
$6C14                A5 60      LDA $60
$6C16                38         SEC
$6C17                E5 68      SBC $68
$6C19                AA         TAX
$6C1A                A5 61      LDA $61
$6C1C                E5 69      SBC $69
$6C1E                A8         TAY
$6C1F                8A         TXA
$6C20                38         SEC
$6C21                E5 7A      SBC $7A
$6C23                85 7A      STA $7A
$6C25                98         TYA
$6C26                E5 7B      SBC $7B
$6C28                85 7B      STA $7B
$6C2A                A5 6C      LDA $6C
$6C2C                38         SEC
$6C2D                E5 68      SBC $68
$6C2F                AA         TAX
$6C30                A5 6D      LDA $6D
$6C32                E5 69      SBC $69
$6C34                20 DE 65   JSR DIV
$6C37                38         SEC
$6C38                A5 64      LDA $64
$6C3A                E5 6C      SBC $6C
$6C3C                85 7A      STA $7A
$6C3E                A5 65      LDA $65
$6C40                E5 6D      SBC $6D
$6C42                85 7B      STA $7B
$6C44                A5 78      LDA $78
$6C46                A6 79      LDX $79
$6C48                85 A7      STA $A7
$6C4A                86 A8      STX $A8
$6C4C                20 80 64   JSR MULCORE
$6C4F                18         CLC
$6C50                65 6C      ADC $6C
$6C52                85 6C      STA $6C
$6C54                85 68      STA $68
$6C56                8A         TXA
$6C57                65 6D      ADC $6D
$6C59                85 6D      STA $6D
$6C5B                85 69      STA $69
$6C5D                38         SEC
$6C5E                A5 62      LDA $62
$6C60                E5 6A      SBC $6A
$6C62                85 7A      STA $7A
$6C64                A5 63      LDA $63
$6C66                E5 6B      SBC $6B
$6C68                85 7B      STA $7B
$6C6A                A5 A7      LDA $A7
$6C6C                A6 A8      LDX $A8
$6C6E                85 78      STA $78
$6C70                86 79      STX $79
$6C72                20 80 64   JSR MULCORE
$6C75                18         CLC
$6C76                65 6A      ADC $6A
$6C78                85 6A      STA $6A
$6C7A                8A         TXA
$6C7B                65 6B      ADC $6B
$6C7D                85 6B      STA $6B
$6C7F                4C 7B 6A   JMP OUTCODE2
$6C82                38         SEC
$6C83                A5 64      LDA $64
$6C85                E5 6C      SBC $6C
$6C87                85 7A      STA $7A
$6C89                A5 65      LDA $65
$6C8B                E5 6D      SBC $6D
$6C8D                85 7B      STA $7B
$6C8F                A5 68      LDA $68
$6C91                38         SEC
$6C92                E5 60      SBC $60
$6C94                AA         TAX
$6C95                A5 69      LDA $69
$6C97                E5 61      SBC $61
$6C99                A8         TAY
$6C9A                8A         TXA
$6C9B                38         SEC
$6C9C                E5 7A      SBC $7A
$6C9E                85 7A      STA $7A
$6CA0                98         TYA
$6CA1                E5 7B      SBC $7B
$6CA3                85 7B      STA $7B
$6CA5                A5 6C      LDA $6C
$6CA7                18         CLC
$6CA8                65 68      ADC $68
$6CAA                AA         TAX
$6CAB                A5 6D      LDA $6D
$6CAD                65 69      ADC $69
$6CAF                20 DE 65   JSR DIV
$6CB2                38         SEC
$6CB3                A5 62      LDA $62
$6CB5                E5 6A      SBC $6A
$6CB7                85 7A      STA $7A
$6CB9                A5 63      LDA $63
$6CBB                E5 6B      SBC $6B
$6CBD                85 7B      STA $7B
$6CBF                A5 78      LDA $78
$6CC1                A6 79      LDX $79
$6CC3                85 A7      STA $A7
$6CC5                86 A8      STX $A8
$6CC7                20 80 64   JSR MULCORE
$6CCA                18         CLC
$6CCB                65 6A      ADC $6A
$6CCD                85 6A      STA $6A
$6CCF                8A         TXA
$6CD0                65 6B      ADC $6B
$6CD2                85 6B      STA $6B
$6CD4                38         SEC
$6CD5                A5 64      LDA $64
$6CD7                E5 6C      SBC $6C
$6CD9                85 7A      STA $7A
$6CDB                A5 65      LDA $65
$6CDD                E5 6D      SBC $6D
$6CDF                85 7B      STA $7B
$6CE1                A5 A7      LDA $A7
$6CE3                A6 A8      LDX $A8
$6CE5                85 78      STA $78
$6CE7                86 79      STX $79
$6CE9                20 80 64   JSR MULCORE
$6CEC                18         CLC
$6CED                65 6C      ADC $6C
$6CEF                85 6C      STA $6C
$6CF1                49 FF      EOR #$FF
$6CF3                85 68      STA $68
$6CF5                8A         TXA
$6CF6                65 6D      ADC $6D
$6CF8                85 6D      STA $6D
$6CFA                49 FF      EOR #$FF
$6CFC                85 69      STA $69
$6CFE                E6 68      INC $68
$6D00                D0 02      BNE $6D04
$6D02                E6 69      INC $69
$6D04                4C 7B 6A   JMP OUTCODE2
$6D07  OP19:         C8         INY
$6D08                B1 9B      LDA ($9B),Y
$6D0A                D0 03      BNE $6D0F
$6D0C                4C DE 70   JMP ADV13
$6D0F                C9 FF      CMP #$FF
$6D11                F0 05      BEQ $6D18
$6D13                38         SEC
$6D14                E9 01      SBC #$01
$6D16                91 9B      STA ($9B),Y
$6D18                A2 1E      LDX #$1E
$6D1A                B5 7E      LDA $7E,X
$6D1C                48         PHA
$6D1D                CA         DEX
$6D1E                10 FA      BPL $6D1A
$6D20                A2 90      LDX #$90
$6D22                20 E3 70   JSR SUB16
$6D25                20 E3 70   JSR SUB16
$6D28                20 E3 70   JSR SUB16
$6D2B                C8         INY
$6D2C                B1 9B      LDA ($9B),Y
$6D2E                85 96      STA $96
$6D30                C8         INY
$6D31                B1 9B      LDA ($9B),Y
$6D33                85 97      STA $97
$6D35                C8         INY
$6D36                B1 9B      LDA ($9B),Y
$6D38                85 98      STA $98
$6D3A                C8         INY
$6D3B                B1 9B      LDA ($9B),Y
$6D3D                48         PHA
$6D3E                C8         INY
$6D3F                B1 9B      LDA ($9B),Y
$6D41                85 9C      STA $9C
$6D43                68         PLA
$6D44                85 9B      STA $9B
$6D46                A5 96      LDA $96
$6D48                20 C8 61   JSR SIN.A
$6D4B                85 60      STA $60
$6D4D                86 61      STX $61
$6D4F                A5 97      LDA $97
$6D51                20 C8 61   JSR SIN.A
$6D54                85 64      STA $64
$6D56                86 65      STX $65
$6D58                A5 98      LDA $98
$6D5A                20 C8 61   JSR SIN.A
$6D5D                85 68      STA $68
$6D5F                86 69      STX $69
$6D61                A5 96      LDA $96
$6D63                20 CB 61   JSR COS.A
$6D66                85 62      STA $62
$6D68                86 63      STX $63
$6D6A                A5 97      LDA $97
$6D6C                20 CB 61   JSR COS.A
$6D6F                85 66      STA $66
$6D71                86 67      STX $67
$6D73                A5 98      LDA $98
$6D75                20 CB 61   JSR COS.A
$6D78                85 6A      STA $6A
$6D7A                86 6B      STX $6B
$6D7C                A2 90      LDX #$90
$6D7E                A0 6A      LDY #$6A
$6D80                A9 AB      LDA #$AB
$6D82                20 61 64   JSR MUL16
$6D85                A2 90      LDX #$90
$6D87                A0 68      LDY #$68
$6D89                A9 AF      LDA #$AF
$6D8B                20 61 64   JSR MUL16
$6D8E                A2 94      LDX #$94
$6D90                A0 68      LDY #$68
$6D92                A9 AD      LDA #$AD
$6D94                20 61 64   JSR MUL16
$6D97                38         SEC
$6D98                A5 AB      LDA $AB
$6D9A                E5 AD      SBC $AD
$6D9C                85 90      STA $90
$6D9E                A5 AC      LDA $AC
$6DA0                E5 AE      SBC $AE
$6DA2                85 91      STA $91
$6DA4                A2 94      LDX #$94
$6DA6                A0 6A      LDY #$6A
$6DA8                A9 AD      LDA #$AD
$6DAA                20 61 64   JSR MUL16
$6DAD                18         CLC
$6DAE                A5 AD      LDA $AD
$6DB0                65 AF      ADC $AF
$6DB2                85 94      STA $94
$6DB4                A5 AE      LDA $AE
$6DB6                65 B0      ADC $B0
$6DB8                85 95      STA $95
$6DBA                A2 92      LDX #$92
$6DBC                A0 62      LDY #$62
$6DBE                A9 AB      LDA #$AB
$6DC0                20 61 64   JSR MUL16
$6DC3                A2 92      LDX #$92
$6DC5                A0 60      LDY #$60
$6DC7                A9 AF      LDA #$AF
$6DC9                20 61 64   JSR MUL16
$6DCC                A2 94      LDX #$94
$6DCE                A0 60      LDY #$60
$6DD0                A9 AD      LDA #$AD
$6DD2                20 61 64   JSR MUL16
$6DD5                18         CLC
$6DD6                A5 AB      LDA $AB
$6DD8                65 AD      ADC $AD
$6DDA                85 92      STA $92
$6DDC                A5 AC      LDA $AC
$6DDE                65 AE      ADC $AE
$6DE0                85 93      STA $93
$6DE2                A2 94      LDX #$94
$6DE4                A0 62      LDY #$62
$6DE6                A9 AD      LDA #$AD
$6DE8                20 61 64   JSR MUL16
$6DEB                38         SEC
$6DEC                A5 AD      LDA $AD
$6DEE                E5 AF      SBC $AF
$6DF0                85 94      STA $94
$6DF2                A5 AE      LDA $AE
$6DF4                E5 B0      SBC $B0
$6DF6                85 95      STA $95
$6DF8                A2 90      LDX #$90
$6DFA                A0 66      LDY #$66
$6DFC                A9 AB      LDA #$AB
$6DFE                20 61 64   JSR MUL16
$6E01                A2 90      LDX #$90
$6E03                A0 64      LDY #$64
$6E05                A9 AF      LDA #$AF
$6E07                20 61 64   JSR MUL16
$6E0A                A2 92      LDX #$92
$6E0C                A0 64      LDY #$64
$6E0E                A9 AD      LDA #$AD
$6E10                20 61 64   JSR MUL16
$6E13                18         CLC
$6E14                A5 AB      LDA $AB
$6E16                65 AD      ADC $AD
$6E18                85 90      STA $90
$6E1A                A5 AC      LDA $AC
$6E1C                65 AE      ADC $AE
$6E1E                85 91      STA $91
$6E20                A2 92      LDX #$92
$6E22                A0 66      LDY #$66
$6E24                A9 AD      LDA #$AD
$6E26                20 61 64   JSR MUL16
$6E29                38         SEC
$6E2A                A5 AD      LDA $AD
$6E2C                E5 AF      SBC $AF
$6E2E                85 92      STA $92
$6E30                A5 AE      LDA $AE
$6E32                E5 B0      SBC $B0
$6E34                85 93      STA $93
$6E36                A9 00      LDA #$00
$6E38                38         SEC
$6E39                E5 68      SBC $68
$6E3B                85 74      STA $74
$6E3D                A9 00      LDA #$00
$6E3F                E5 69      SBC $69
$6E41                85 75      STA $75
$6E43                A2 6A      LDX #$6A
$6E45                A0 7E      LDY #$7E
$6E47                A9 6C      LDA #$6C
$6E49                20 61 64   JSR MUL16
$6E4C                A2 74      LDX #$74
$6E4E                A0 8A      LDY #$8A
$6E50                A9 72      LDA #$72
$6E52                20 61 64   JSR MUL16
$6E55                18         CLC
$6E56                A5 6C      LDA $6C
$6E58                65 72      ADC $72
$6E5A                85 6C      STA $6C
$6E5C                A5 6D      LDA $6D
$6E5E                65 73      ADC $73
$6E60                85 6D      STA $6D
$6E62                A2 6A      LDX #$6A
$6E64                A0 80      LDY #$80
$6E66                A9 6E      LDA #$6E
$6E68                20 61 64   JSR MUL16
$6E6B                A2 74      LDX #$74
$6E6D                A0 8C      LDY #$8C
$6E6F                A9 72      LDA #$72
$6E71                20 61 64   JSR MUL16
$6E74                18         CLC
$6E75                A5 6E      LDA $6E
$6E77                65 72      ADC $72
$6E79                85 6E      STA $6E
$6E7B                A5 6F      LDA $6F
$6E7D                65 73      ADC $73
$6E7F                85 6F      STA $6F
$6E81                A2 6A      LDX #$6A
$6E83                A0 82      LDY #$82
$6E85                A9 70      LDA #$70
$6E87                20 61 64   JSR MUL16
$6E8A                A2 74      LDX #$74
$6E8C                A0 8E      LDY #$8E
$6E8E                A9 72      LDA #$72
$6E90                20 61 64   JSR MUL16
$6E93                18         CLC
$6E94                A5 70      LDA $70
$6E96                65 72      ADC $72
$6E98                85 70      STA $70
$6E9A                A5 71      LDA $71
$6E9C                65 73      ADC $73
$6E9E                85 71      STA $71
$6EA0                A2 68      LDX #$68
$6EA2                A0 7E      LDY #$7E
$6EA4                A9 72      LDA #$72
$6EA6                20 61 64   JSR MUL16
$6EA9                A2 6A      LDX #$6A
$6EAB                A0 8A      LDY #$8A
$6EAD                A9 8A      LDA #$8A
$6EAF                20 61 64   JSR MUL16
$6EB2                18         CLC
$6EB3                A5 8A      LDA $8A
$6EB5                65 72      ADC $72
$6EB7                85 8A      STA $8A
$6EB9                A5 8B      LDA $8B
$6EBB                65 73      ADC $73
$6EBD                85 8B      STA $8B
$6EBF                A5 6C      LDA $6C
$6EC1                A6 6D      LDX $6D
$6EC3                85 7E      STA $7E
$6EC5                86 7F      STX $7F
$6EC7                A2 68      LDX #$68
$6EC9                A0 80      LDY #$80
$6ECB                A9 72      LDA #$72
$6ECD                20 61 64   JSR MUL16
$6ED0                A2 6A      LDX #$6A
$6ED2                A0 8C      LDY #$8C
$6ED4                A9 8C      LDA #$8C
$6ED6                20 61 64   JSR MUL16
$6ED9                18         CLC
$6EDA                A5 8C      LDA $8C
$6EDC                65 72      ADC $72
$6EDE                85 8C      STA $8C
$6EE0                A5 8D      LDA $8D
$6EE2                65 73      ADC $73
$6EE4                85 8D      STA $8D
$6EE6                A5 6E      LDA $6E
$6EE8                A6 6F      LDX $6F
$6EEA                85 80      STA $80
$6EEC                86 81      STX $81
$6EEE                A2 68      LDX #$68
$6EF0                A0 82      LDY #$82
$6EF2                A9 72      LDA #$72
$6EF4                20 61 64   JSR MUL16
$6EF7                A2 6A      LDX #$6A
$6EF9                A0 8E      LDY #$8E
$6EFB                A9 8E      LDA #$8E
$6EFD                20 61 64   JSR MUL16
$6F00                18         CLC
$6F01                A5 8E      LDA $8E
$6F03                65 72      ADC $72
$6F05                85 8E      STA $8E
$6F07                A5 8F      LDA $8F
$6F09                65 73      ADC $73
$6F0B                85 8F      STA $8F
$6F0D                A5 70      LDA $70
$6F0F                A6 71      LDX $71
$6F11                85 82      STA $82
$6F13                86 83      STX $83
$6F15                A9 00      LDA #$00
$6F17                38         SEC
$6F18                E5 60      SBC $60
$6F1A                85 74      STA $74
$6F1C                A9 00      LDA #$00
$6F1E                E5 61      SBC $61
$6F20                85 75      STA $75
$6F22                A2 62      LDX #$62
$6F24                A0 84      LDY #$84
$6F26                A9 6C      LDA #$6C
$6F28                20 61 64   JSR MUL16
$6F2B                A2 60      LDX #$60
$6F2D                A0 8A      LDY #$8A
$6F2F                A9 72      LDA #$72
$6F31                20 61 64   JSR MUL16
$6F34                18         CLC
$6F35                A5 6C      LDA $6C
$6F37                65 72      ADC $72
$6F39                85 6C      STA $6C
$6F3B                A5 6D      LDA $6D
$6F3D                65 73      ADC $73
$6F3F                85 6D      STA $6D
$6F41                A2 62      LDX #$62
$6F43                A0 86      LDY #$86
$6F45                A9 6E      LDA #$6E
$6F47                20 61 64   JSR MUL16
$6F4A                A2 60      LDX #$60
$6F4C                A0 8C      LDY #$8C
$6F4E                A9 72      LDA #$72
$6F50                20 61 64   JSR MUL16
$6F53                18         CLC
$6F54                A5 6E      LDA $6E
$6F56                65 72      ADC $72
$6F58                85 6E      STA $6E
$6F5A                A5 6F      LDA $6F
$6F5C                65 73      ADC $73
$6F5E                85 6F      STA $6F
$6F60                A2 62      LDX #$62
$6F62                A0 88      LDY #$88
$6F64                A9 70      LDA #$70
$6F66                20 61 64   JSR MUL16
$6F69                A2 60      LDX #$60
$6F6B                A0 8E      LDY #$8E
$6F6D                A9 72      LDA #$72
$6F6F                20 61 64   JSR MUL16
$6F72                18         CLC
$6F73                A5 70      LDA $70
$6F75                65 72      ADC $72
$6F77                85 70      STA $70
$6F79                A5 71      LDA $71
$6F7B                65 73      ADC $73
$6F7D                85 71      STA $71
$6F7F                A2 74      LDX #$74
$6F81                A0 84      LDY #$84
$6F83                A9 72      LDA #$72
$6F85                20 61 64   JSR MUL16
$6F88                A2 62      LDX #$62
$6F8A                A0 8A      LDY #$8A
$6F8C                A9 8A      LDA #$8A
$6F8E                20 61 64   JSR MUL16
$6F91                18         CLC
$6F92                A5 8A      LDA $8A
$6F94                65 72      ADC $72
$6F96                85 8A      STA $8A
$6F98                A5 8B      LDA $8B
$6F9A                65 73      ADC $73
$6F9C                85 8B      STA $8B
$6F9E                A5 6C      LDA $6C
$6FA0                A6 6D      LDX $6D
$6FA2                85 84      STA $84
$6FA4                86 85      STX $85
$6FA6                A2 74      LDX #$74
$6FA8                A0 86      LDY #$86
$6FAA                A9 72      LDA #$72
$6FAC                20 61 64   JSR MUL16
$6FAF                A2 62      LDX #$62
$6FB1                A0 8C      LDY #$8C
$6FB3                A9 8C      LDA #$8C
$6FB5                20 61 64   JSR MUL16
$6FB8                18         CLC
$6FB9                A5 8C      LDA $8C
$6FBB                65 72      ADC $72
$6FBD                85 8C      STA $8C
$6FBF                A5 8D      LDA $8D
$6FC1                65 73      ADC $73
$6FC3                85 8D      STA $8D
$6FC5                A5 6E      LDA $6E
$6FC7                A6 6F      LDX $6F
$6FC9                85 86      STA $86
$6FCB                86 87      STX $87
$6FCD                A2 74      LDX #$74
$6FCF                A0 88      LDY #$88
$6FD1                A9 72      LDA #$72
$6FD3                20 61 64   JSR MUL16
$6FD6                A2 62      LDX #$62
$6FD8                A0 8E      LDY #$8E
$6FDA                A9 8E      LDA #$8E
$6FDC                20 61 64   JSR MUL16
$6FDF                18         CLC
$6FE0                A5 8E      LDA $8E
$6FE2                65 72      ADC $72
$6FE4                85 8E      STA $8E
$6FE6                A5 8F      LDA $8F
$6FE8                65 73      ADC $73
$6FEA                85 8F      STA $8F
$6FEC                A5 70      LDA $70
$6FEE                A6 71      LDX $71
$6FF0                85 88      STA $88
$6FF2                86 89      STX $89
$6FF4                A9 00      LDA #$00
$6FF6                38         SEC
$6FF7                E5 64      SBC $64
$6FF9                85 74      STA $74
$6FFB                A9 00      LDA #$00
$6FFD                E5 65      SBC $65
$6FFF                85 75      STA $75
$7001                A2 66      LDX #$66
$7003                A0 7E      LDY #$7E
$7005                A9 6C      LDA #$6C
$7007                20 61 64   JSR MUL16
$700A                A2 64      LDX #$64
$700C                A0 84      LDY #$84
$700E                A9 72      LDA #$72
$7010                20 61 64   JSR MUL16
$7013                18         CLC
$7014                A5 6C      LDA $6C
$7016                65 72      ADC $72
$7018                85 6C      STA $6C
$701A                A5 6D      LDA $6D
$701C                65 73      ADC $73
$701E                85 6D      STA $6D
$7020                A2 66      LDX #$66
$7022                A0 80      LDY #$80
$7024                A9 6E      LDA #$6E
$7026                20 61 64   JSR MUL16
$7029                A2 64      LDX #$64
$702B                A0 86      LDY #$86
$702D                A9 72      LDA #$72
$702F                20 61 64   JSR MUL16
$7032                18         CLC
$7033                A5 6E      LDA $6E
$7035                65 72      ADC $72
$7037                85 6E      STA $6E
$7039                A5 6F      LDA $6F
$703B                65 73      ADC $73
$703D                85 6F      STA $6F
$703F                A2 66      LDX #$66
$7041                A0 82      LDY #$82
$7043                A9 70      LDA #$70
$7045                20 61 64   JSR MUL16
$7048                A2 64      LDX #$64
$704A                A0 88      LDY #$88
$704C                A9 72      LDA #$72
$704E                20 61 64   JSR MUL16
$7051                18         CLC
$7052                A5 70      LDA $70
$7054                65 72      ADC $72
$7056                85 70      STA $70
$7058                A5 71      LDA $71
$705A                65 73      ADC $73
$705C                85 71      STA $71
$705E                A2 74      LDX #$74
$7060                A0 7E      LDY #$7E
$7062                A9 72      LDA #$72
$7064                20 61 64   JSR MUL16
$7067                A2 66      LDX #$66
$7069                A0 84      LDY #$84
$706B                A9 84      LDA #$84
$706D                20 61 64   JSR MUL16
$7070                18         CLC
$7071                A5 84      LDA $84
$7073                65 72      ADC $72
$7075                85 84      STA $84
$7077                A5 85      LDA $85
$7079                65 73      ADC $73
$707B                85 85      STA $85
$707D                A5 6C      LDA $6C
$707F                A6 6D      LDX $6D
$7081                85 7E      STA $7E
$7083                86 7F      STX $7F
$7085                A2 74      LDX #$74
$7087                A0 80      LDY #$80
$7089                A9 72      LDA #$72
$708B                20 61 64   JSR MUL16
$708E                A2 66      LDX #$66
$7090                A0 86      LDY #$86
$7092                A9 86      LDA #$86
$7094                20 61 64   JSR MUL16
$7097                18         CLC
$7098                A5 86      LDA $86
$709A                65 72      ADC $72
$709C                85 86      STA $86
$709E                A5 87      LDA $87
$70A0                65 73      ADC $73
$70A2                85 87      STA $87
$70A4                A5 6E      LDA $6E
$70A6                A6 6F      LDX $6F
$70A8                85 80      STA $80
$70AA                86 81      STX $81
$70AC                A2 74      LDX #$74
$70AE                A0 82      LDY #$82
$70B0                A9 72      LDA #$72
$70B2                20 61 64   JSR MUL16
$70B5                A2 66      LDX #$66
$70B7                A0 88      LDY #$88
$70B9                A9 88      LDA #$88
$70BB                20 61 64   JSR MUL16
$70BE                18         CLC
$70BF                A5 88      LDA $88
$70C1                65 72      ADC $72
$70C3                85 88      STA $88
$70C5                A5 89      LDA $89
$70C7                65 73      ADC $73
$70C9                85 89      STA $89
$70CB                A5 70      LDA $70
$70CD                A6 71      LDX $71
$70CF                85 82      STA $82
$70D1                86 83      STX $83
$70D3                20 18 61   JSR NEXTOP
$70D6                A2 E1      LDX #$E1
$70D8                68         PLA
$70D9                95 9D      STA $9D,X
$70DB                E8         INX
$70DC                D0 FA      BNE $70D8
$70DE  ADV13:        A9 0D      LDA #$0D
$70E0                4C B7 63   JMP ADV.A
$70E3  SUB16:        38         SEC
$70E4                B5 00      LDA $00,X
$70E6                C8         INY
$70E7                F1 9B      SBC ($9B),Y
$70E9                95 00      STA $00,X
$70EB                E8         INX
$70EC                B5 00      LDA $00,X
$70EE                C8         INY
$70EF                F1 9B      SBC ($9B),Y
$70F1                95 00      STA $00,X
$70F3                E8         INX
$70F4                60         RTS
$70F5  OP21:         C8         INY
$70F6                B1 9B      LDA ($9B),Y
$70F8                85 B3      STA $B3
$70FA                C8         INY
$70FB                B1 9B      LDA ($9B),Y
$70FD                6A         ROR A
$70FE                66 B3      ROR $B3
$7100                A9 00      LDA #$00
$7102                6A         ROR A
$7103                85 A4      STA $A4
$7105                C8         INY
$7106                B1 9B      LDA ($9B),Y
$7108                85 B4      STA $B4
$710A                C8         INY
$710B                B1 9B      LDA ($9B),Y
$710D                85 B5      STA $B5
$710F                C8         INY
$7110                B1 9B      LDA ($9B),Y
$7112                6A         ROR A
$7113                66 B5      ROR $B5
$7115                A9 00      LDA #$00
$7117                6A         ROR A
$7118                85 A3      STA $A3
$711A                C8         INY
$711B                B1 9B      LDA ($9B),Y
$711D                85 B6      STA $B6
$711F                20 42 7E   JSR $7E42
$7122                A9 07      LDA #$07
$7124                4C B7 63   JMP ADV.A
$7127                .byte $00, $00, $00
$712A  OP22:         C8         INY
$712B                B1 9B      LDA ($9B),Y
$712D                8D 28 71   STA $7128
$7130                C8         INY
$7131                B1 9B      LDA ($9B),Y
$7133                8D 27 71   STA $7127
$7136                C8         INY
$7137                B1 9B      LDA ($9B),Y
$7139                8D 29 71   STA $7129
$713C                A9 04      LDA #$04
$713E                4C B7 63   JMP ADV.A
$7141  OP23:         C8         INY
$7142                B1 9B      LDA ($9B),Y
$7144                20 9F 71   JSR $719F
$7147                85 A4      STA $A4
$7149                86 B3      STX $B3
$714B                C8         INY
$714C                B1 9B      LDA ($9B),Y
$714E                18         CLC
$714F                6D 29 71   ADC $7129
$7152                85 B4      STA $B4
$7154                C8         INY
$7155                B1 9B      LDA ($9B),Y
$7157                20 9F 71   JSR $719F
$715A                85 A3      STA $A3
$715C                86 B5      STX $B5
$715E                C8         INY
$715F                B1 9B      LDA ($9B),Y
$7161                18         CLC
$7162                6D 29 71   ADC $7129
$7165                85 B6      STA $B6
$7167                20 42 7E   JSR $7E42
$716A                A9 05      LDA #$05
$716C                4C B7 63   JMP ADV.A
$716F  OP24:         C8         INY
$7170                B1 9B      LDA ($9B),Y
$7172                AA         TAX
$7173                C8         INY
$7174                B1 9B      LDA ($9B),Y
$7176                20 B7 71   JSR $71B7
$7179                85 A4      STA $A4
$717B                C8         INY
$717C                B1 9B      LDA ($9B),Y
$717E                A8         TAY
$717F                20 14 77   JSR $7714
$7182                A9 04      LDA #$04
$7184                4C B7 63   JMP ADV.A
$7187  OP25:         C8         INY
$7188                B1 9B      LDA ($9B),Y
$718A                20 9F 71   JSR $719F
$718D                85 A4      STA $A4
$718F                C8         INY
$7190                B1 9B      LDA ($9B),Y
$7192                18         CLC
$7193                6D 29 71   ADC $7129
$7196                A8         TAY
$7197                20 14 77   JSR $7714
$719A                A9 03      LDA #$03
$719C                4C B7 63   JMP ADV.A
$719F                18         CLC
$71A0                30 0C      BMI $71AE
$71A2                6D 28 71   ADC $7128
$71A5                AA         TAX
$71A6                A9 00      LDA #$00
$71A8                6D 27 71   ADC $7127
$71AB                4C B7 71   JMP $71B7
$71AE                6D 28 71   ADC $7128
$71B1                AA         TAX
$71B2                A9 FF      LDA #$FF
$71B4                6D 27 71   ADC $7127
$71B7                6A         ROR A
$71B8                8A         TXA
$71B9                6A         ROR A
$71BA                AA         TAX
$71BB                A9 00      LDA #$00
$71BD                6A         ROR A
$71BE                60         RTS
$71BF  OP26:         C8         INY
$71C0                B1 9B      LDA ($9B),Y
$71C2                AA         TAX
$71C3                C8         INY
$71C4                B1 9B      LDA ($9B),Y
$71C6                F0 05      BEQ $71CD
$71C8                A9 03      LDA #$03
$71CA                4C B7 63   JMP ADV.A
$71CD                8A         TXA
$71CE                18         CLC
$71CF                69 03      ADC #$03
$71D1                4C B7 63   JMP ADV.A
$71D4  OP27:         C8         INY
$71D5                B1 9B      LDA ($9B),Y
$71D7                AA         TAX
$71D8                F0 13      BEQ $71ED
$71DA                A9 9D      LDA #$9D
$71DC                85 A4      STA $A4
$71DE                A9 71      LDA #$71
$71E0                85 A3      STA $A3
$71E2                E6 A3      INC $A3
$71E4                D0 FC      BNE $71E2
$71E6                E6 A4      INC $A4
$71E8                D0 F8      BNE $71E2
$71EA                CA         DEX
$71EB                D0 ED      BNE $71DA
$71ED                4C B5 63   JMP ADV2
$71F0                A2 05      LDX #$05
$71F2                B5 AB      LDA $AB,X
$71F4                9D FB 80   STA $80FB,X
$71F7                CA         DEX
$71F8                10 F8      BPL $71F2
$71FA                AD F5 71   LDA $71F5
$71FD                18         CLC
$71FE                69 06      ADC #$06
$7200                8D F5 71   STA $71F5
$7203                90 03      BCC $7208
$7205                EE F6 71   INC $71F6
$7208                60         RTS
$7209  OP28:         C8         INY
$720A                B1 9B      LDA ($9B),Y
$720C                8D F5 71   STA $71F5
$720F                C8         INY
$7210                B1 9B      LDA ($9B),Y
$7212                8D F6 71   STA $71F6
$7215                A9 03      LDA #$03
$7217                4C B7 63   JMP ADV.A
$721A  OP29:         C8         INY
$721B                B1 9B      LDA ($9B),Y
$721D                8D 1E 62   STA MODE29
$7220                4C B5 63   JMP ADV2
$7223                .byte $3D, $39, $35, $31, $2D, $29, $25, $21, $3D, $39, $35, $31, $2D, $29, $25, $21
$7233                .byte $3C, $38, $34, $30, $2C, $28, $24, $20, $3C, $38, $34, $30, $2C, $28, $24, $20
$7243                .byte $3F, $3B, $37, $33, $2F, $2B, $27, $23, $3F, $3B, $37, $33, $2F, $2B, $27, $23
$7253                .byte $3E, $3A, $36, $32, $2E, $2A, $26, $22, $3E, $3A, $36, $32, $2E, $2A, $26, $22
$7263                .byte $3D, $39, $35, $31, $2D, $29, $25, $21, $3D, $39, $35, $31, $2D, $29, $25, $21
$7273                .byte $3C, $38, $34, $30, $2C, $28, $24, $20, $3C, $38, $34, $30, $2C, $28, $24, $20
$7283                .byte $3C, $38, $34, $30, $2C, $28, $24, $20, $3C, $38, $34, $30, $2C, $28, $24, $20
$7293                .byte $3C, $38, $34, $30, $2C, $28, $24, $20, $3C, $38, $34, $30, $2C, $28, $24, $20
$72A3                .byte $3F, $3B, $37, $33, $2F, $2B, $27, $23, $3F, $3B, $37, $33, $2F, $2B, $27, $23
$72B3                .byte $3F, $3B, $37, $33, $2F, $2B, $27, $23, $3F, $3B, $37, $33, $2F, $2B, $27, $23
$72C3                .byte $3F, $3B, $37, $33, $2F, $2B, $27, $23, $3F, $3B, $37, $33, $2F, $2B, $27, $23
$72D3                .byte $3E, $3A, $36, $32, $2E, $2A, $26, $22, $3E, $3A, $36, $32, $2E, $2A, $26, $22
$72E3                .byte $3D, $39, $35, $31, $2D, $29, $25, $21, $3D, $39, $35, $31, $2D, $29, $25, $21
$72F3                .byte $3C, $38, $34, $30, $2C, $28, $24, $20, $3C, $38, $34, $30, $2C, $28, $24, $20
$7303                .byte $3F, $3B, $37, $33, $2F, $2B, $27, $23, $3F, $3B, $37, $33, $2F, $2B, $27, $23
$7313                .byte $3E, $3A, $36, $32, $2E, $2A, $26, $22, $3E, $3A, $36, $32, $2E, $2A, $26, $22
$7323                .byte $A8, $A8, $A8, $A8, $A8, $A8, $A8, $A8, $28, $28, $28, $28, $28, $28, $28, $28
$7333                .byte $A8, $A8, $A8, $A8, $A8, $A8, $A8, $A8, $28, $28, $28, $28, $28, $28, $28, $28
$7343                .byte $80, $80, $80, $80, $80, $80, $80, $80, $00, $00, $00, $00, $00, $00, $00, $00
$7353                .byte $80, $80, $80, $80, $80, $80, $80, $80, $00, $00, $00, $00, $00, $00, $00, $00
$7363                .byte $80, $80, $80, $80, $80, $80, $80, $80, $00, $00, $00, $00, $00, $00, $00, $00
$7373                .byte $80, $80, $80, $80, $80, $80, $80, $80, $00, $00, $00, $00, $00, $00, $00, $00
$7383                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$7393                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$73A3                .byte $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0
$73B3                .byte $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0
$73C3                .byte $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $50, $50, $50, $50, $50, $50, $50, $50
$73D3                .byte $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $50, $50, $50, $50, $50, $50, $50, $50
$73E3                .byte $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $50, $50, $50, $50, $50, $50, $50, $50
$73F3                .byte $D0, $D0, $D0, $D0, $D0, $D0, $D0, $D0, $50, $50, $50, $50, $50, $50, $50, $50
$7403                .byte $A8, $A8, $A8, $A8, $A8, $A8, $A8, $A8, $28, $28, $28, $28, $28, $28, $28, $28
$7413                .byte $A8, $A8, $A8, $A8, $A8, $A8, $A8, $A8, $28, $28, $28, $28, $28, $28, $28, $28
$7423                .byte $14, $14, $14, $14, $15, $15, $15, $16, $16, $16, $16, $17, $17, $17, $18, $18
$7433                .byte $18, $18, $19, $19, $19, $1A, $1A, $1A, $1A, $1B, $1B, $1B, $1C, $1C, $1C, $1C
$7443                .byte $1D, $1D, $1D, $1E, $1E, $1E, $1E, $1F, $1F, $1F, $20, $20, $20, $20, $21, $21
$7453                .byte $21, $22, $22, $22, $22, $23, $23, $23, $24, $24, $24, $24, $25, $25, $25, $26
$7463                .byte $26, $26, $26, $27, $27, $27, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$7473                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$7483                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$7493                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$74A3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$74B3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$74C3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$74D3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $01, $01
$74E3                .byte $01, $02, $02, $02, $02, $03, $03, $03, $04, $04, $04, $04, $05, $05, $05, $06
$74F3                .byte $06, $06, $06, $07, $07, $07, $08, $08, $08, $08, $09, $09, $09, $0A, $0A, $0A
$7503                .byte $0A, $0B, $0B, $0B, $0C, $0C, $0C, $0C, $0D, $0D, $0D, $0E, $0E, $0E, $0E, $0F
$7513                .byte $0F, $0F, $10, $10, $10, $10, $11, $11, $11, $12, $12, $12, $12, $13, $13, $13
$7523                .byte $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C
$7533                .byte $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0
$7543                .byte $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18
$7553                .byte $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03
$7563                .byte $0C, $30, $C0, $06, $18, $60, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$7573                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$7583                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$7593                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$75A3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$75B3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$75C3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
$75D3                .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00, $03, $0C, $30, $C0, $06, $18
$75E3                .byte $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03
$75F3                .byte $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30
$7603                .byte $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06
$7613                .byte $18, $60, $03, $0C, $30, $C0, $06, $18, $60, $03, $0C, $30, $C0, $06, $18, $60
$7623  OP08:         20 91 76   JSR CLRPAGE
$7626                4C B5 63   JMP ADV2
$7629                A2 00      LDX #$00
$762B                9D 00 20   STA $2000,X
$762E                9D 00 21   STA $2100,X
$7631                9D 00 22   STA $2200,X
$7634                9D 00 23   STA $2300,X
$7637                9D 00 24   STA $2400,X
$763A                9D 00 25   STA $2500,X
$763D                9D 00 26   STA $2600,X
$7640                9D 00 27   STA $2700,X
$7643                9D 00 28   STA $2800,X
$7646                9D 00 29   STA $2900,X
$7649                9D 00 2A   STA $2A00,X
$764C                9D 00 2B   STA $2B00,X
$764F                9D 00 2C   STA $2C00,X
$7652                9D 00 2D   STA $2D00,X
$7655                9D 00 2E   STA $2E00,X
$7658                9D 00 2F   STA $2F00,X
$765B                9D 00 30   STA $3000,X
$765E                9D 00 31   STA $3100,X
$7661                9D 00 32   STA $3200,X
$7664                9D 00 33   STA $3300,X
$7667                9D 00 34   STA $3400,X
$766A                9D 00 35   STA $3500,X
$766D                9D 00 36   STA $3600,X
$7670                9D 00 37   STA $3700,X
$7673                9D 00 38   STA $3800,X
$7676                9D 00 39   STA $3900,X
$7679                9D 00 3A   STA $3A00,X
$767C                9D 00 3B   STA $3B00,X
$767F                9D 00 3C   STA $3C00,X
$7682                9D 00 3D   STA $3D00,X
$7685                9D 00 3E   STA $3E00,X
$7688                9D 00 3F   STA $3F00,X
$768B                E8         INX
$768C                E8         INX
$768D                E8         INX
$768E                D0 9B      BNE $762B
$7690                60         RTS
$7691  CLRPAGE:      C8         INY
$7692                B1 9B      LDA ($9B),Y
$7694                F0 93      BEQ $7629
$7696                C9 02      CMP #$02
$7698                30 0A      BMI $76A4
$769A                F0 04      BEQ $76A0
$769C                A9 FF      LDA #$FF
$769E                D0 08      BNE $76A8
$76A0                A9 FF      LDA #$FF
$76A2                D0 85      BNE $7629
$76A4                A9 00      LDA #$00
$76A6                F0 00      BEQ $76A8
$76A8                A2 00      LDX #$00
$76AA                9D 00 40   STA $4000,X
$76AD                9D 00 41   STA $4100,X
$76B0                9D 00 42   STA $4200,X
$76B3                9D 00 43   STA $4300,X
$76B6                9D 00 44   STA $4400,X
$76B9                9D 00 45   STA $4500,X
$76BC                9D 00 46   STA $4600,X
$76BF                9D 00 47   STA $4700,X
$76C2                9D 00 48   STA $4800,X
$76C5                9D 00 49   STA $4900,X
$76C8                9D 00 4A   STA $4A00,X
$76CB                9D 00 4B   STA $4B00,X
$76CE                9D 00 4C   STA $4C00,X
$76D1                9D 00 4D   STA $4D00,X
$76D4                9D 00 4E   STA $4E00,X
$76D7                9D 00 4F   STA $4F00,X
$76DA                9D 00 50   STA $5000,X
$76DD                9D 00 51   STA $5100,X
$76E0                9D 00 52   STA $5200,X
$76E3                9D 00 53   STA $5300,X
$76E6                9D 00 54   STA $5400,X
$76E9                9D 00 55   STA $5500,X
$76EC                9D 00 56   STA $5600,X
$76EF                9D 00 57   STA $5700,X
$76F2                9D 00 58   STA $5800,X
$76F5                9D 00 59   STA $5900,X
$76F8                9D 00 5A   STA $5A00,X
$76FB                9D 00 5B   STA $5B00,X
$76FE                9D 00 5C   STA $5C00,X
$7701                9D 00 5D   STA $5D00,X
$7704                9D 00 5E   STA $5E00,X
$7707                9D 00 5F   STA $5F00,X
$770A                E8         INX
$770B                E8         INX
$770C                E8         INX
$770D                D0 9B      BNE $76AA
$770F                60         RTS
$7710                .byte $A9, $00, $85, $A4
$7714                20 AD 7E   JSR $7EAD
$7717                11 99      ORA ($99),Y
$7719                91 99      STA ($99),Y
$771B                60         RTS
$771C  PLOT2D:       4C 1F 77   JMP $771F
$771F                18         CLC
$7720                B9 23 72   LDA $7223,Y
$7723                65 BB      ADC $BB
$7725                85 9A      STA $9A
$7727                B9 23 73   LDA $7323,Y
$772A                18         CLC
$772B                7D 23 74   ADC $7423,X
$772E                A8         TAY
$772F                BD 23 75   LDA $7523,X
$7732                30 05      BMI $7739
$7734                20 26 7D   JSR $7D26
$7737                EA         NOP
$7738                60         RTS
$7739                20 26 7D   JSR $7D26
$773C                EA         NOP
$773D                C8         INY
$773E                A9 01      LDA #$01
$7740                11 99      ORA ($99),Y
$7742                91 99      STA ($99),Y
$7744                60         RTS
$7745  LINE2D:       4C 48 77   JMP $7748
$7748                A5 B5      LDA $B5
$774A                38         SEC
$774B                E5 B3      SBC $B3
$774D                30 2E      BMI $777D
$774F                70 2E      BVS $777F
$7751                85 B9      STA $B9
$7753                A5 B6      LDA $B6
$7755                38         SEC
$7756                E5 B4      SBC $B4
$7758                30 0F      BMI $7769
$775A                70 0F      BVS $776B
$775C                85 BA      STA $BA
$775E                38         SEC
$775F                E5 B9      SBC $B9
$7761                B0 03      BCS $7766
$7763                4C 96 77   JMP $7796
$7766                4C FA 7B   JMP $7BFA
$7769                70 F1      BVS $775C
$776B                49 FF      EOR #$FF
$776D                18         CLC
$776E                69 01      ADC #$01
$7770                85 BA      STA $BA
$7772                38         SEC
$7773                E5 B9      SBC $B9
$7775                90 03      BCC $777A
$7777                4C 90 7C   JMP $7C90
$777A                4C C8 79   JMP $79C8
$777D                70 D2      BVS $7751
$777F                A6 B5      LDX $B5
$7781                86 B3      STX $B3
$7783                49 FF      EOR #$FF
$7785                18         CLC
$7786                69 01      ADC #$01
$7788                85 B9      STA $B9
$778A                A5 B4      LDA $B4
$778C                A6 B6      LDX $B6
$778E                38         SEC
$778F                E5 B6      SBC $B6
$7791                86 B4      STX $B4
$7793                4C 58 77   JMP $7758
$7796                A9 00      LDA #$00
$7798                38         SEC
$7799                E5 B9      SBC $B9
$779B                38         SEC
$779C                6A         ROR A
$779D                85 B8      STA $B8
$779F                A6 B3      LDX $B3
$77A1                A4 B4      LDY $B4
$77A3                18         CLC
$77A4                B9 23 72   LDA $7223,Y
$77A7                65 BB      ADC $BB
$77A9                85 9A      STA $9A
$77AB                B9 23 73   LDA $7323,Y
$77AE                18         CLC
$77AF                7D 23 74   ADC $7423,X
$77B2                A8         TAY
$77B3                BD 23 75   LDA $7523,X
$77B6                85 B7      STA $B7
$77B8                A6 B9      LDX $B9
$77BA                E8         INX
$77BB                29 7F      AND #$7F
$77BD                C9 18      CMP #$18
$77BF                30 1C      BMI $77DD
$77C1                F0 15      BEQ $77D8
$77C3                C9 40      CMP #$40
$77C5                30 07      BMI $77CE
$77C7                F0 0A      BEQ $77D3
$77C9                20 8A 79   JSR $798A
$77CC                D0 22      BNE $77F0
$77CE                20 7C 78   JSR $787C
$77D1                D0 1D      BNE $77F0
$77D3                20 BD 78   JSR $78BD
$77D6                D0 18      BNE $77F0
$77D8                20 42 79   JSR $7942
$77DB                D0 13      BNE $77F0
$77DD                C9 06      CMP #$06
$77DF                30 07      BMI $77E8
$77E1                F0 0A      BEQ $77ED
$77E3                20 08 78   JSR $7808
$77E6                D0 08      BNE $77F0
$77E8                20 F5 77   JSR $77F5
$77EB                D0 03      BNE $77F0
$77ED                20 D1 78   JSR $78D1
$77F0                20 26 7D   JSR $7D26
$77F3                EA         NOP
$77F4                60         RTS
$77F5                A5 B8      LDA $B8
$77F7                CA         DEX
$77F8                F0 1A      BEQ $7814
$77FA                18         CLC
$77FB                65 BA      ADC $BA
$77FD                B0 1E      BCS $781D
$77FF                CA         DEX
$7800                F0 15      BEQ $7817
$7802                65 BA      ADC $BA
$7804                B0 31      BCS $7837
$7806                D0 51      BNE $7859
$7808                CA         DEX
$7809                F0 0F      BEQ $781A
$780B                A5 B8      LDA $B8
$780D                18         CLC
$780E                65 BA      ADC $BA
$7810                B0 2D      BCS $783F
$7812                D0 5B      BNE $786F
$7814                A9 03      LDA #$03
$7816                60         RTS
$7817                A9 0F      LDA #$0F
$7819                60         RTS
$781A                A9 0C      LDA #$0C
$781C                60         RTS
$781D                E5 B9      SBC $B9
$781F                85 B8      STA $B8
$7821                A9 03      LDA #$03
$7823                20 26 7D   JSR $7D26
$7826                EA         NOP
$7827                A5 9A      LDA $9A
$7829                18         CLC
$782A                E9 03      SBC #$03
$782C                85 9A      STA $9A
$782E                C5 BC      CMP $BC
$7830                B0 D6      BCS $7808
$7832                20 A6 79   JSR $79A6
$7835                B0 D1      BCS $7808
$7837                E5 B9      SBC $B9
$7839                85 B8      STA $B8
$783B                A9 0F      LDA #$0F
$783D                D0 06      BNE $7845
$783F                E5 B9      SBC $B9
$7841                85 B8      STA $B8
$7843                A9 0C      LDA #$0C
$7845                20 26 7D   JSR $7D26
$7848                EA         NOP
$7849                A5 9A      LDA $9A
$784B                18         CLC
$784C                E9 03      SBC #$03
$784E                85 9A      STA $9A
$7850                C5 BC      CMP $BC
$7852                B0 28      BCS $787C
$7854                20 A6 79   JSR $79A6
$7857                B0 23      BCS $787C
$7859                CA         DEX
$785A                F0 0D      BEQ $7869
$785C                65 BA      ADC $BA
$785E                B0 45      BCS $78A5
$7860                85 B8      STA $B8
$7862                A9 7F      LDA #$7F
$7864                10 24      BPL $788A
$7866                A9 3C      LDA #$3C
$7868                60         RTS
$7869                A9 3F      LDA #$3F
$786B                60         RTS
$786C                A9 30      LDA #$30
$786E                60         RTS
$786F                CA         DEX
$7870                F0 F4      BEQ $7866
$7872                65 BA      ADC $BA
$7874                B0 27      BCS $789D
$7876                85 B8      STA $B8
$7878                A9 7C      LDA #$7C
$787A                10 0E      BPL $788A
$787C                CA         DEX
$787D                F0 ED      BEQ $786C
$787F                A5 B8      LDA $B8
$7881                18         CLC
$7882                65 BA      ADC $BA
$7884                B0 0F      BCS $7895
$7886                85 B8      STA $B8
$7888                A9 70      LDA #$70
$788A                20 26 7D   JSR $7D26
$788D                EA         NOP
$788E                C8         INY
$788F                CA         DEX
$7890                D0 30      BNE $78C2
$7892                A9 01      LDA #$01
$7894                60         RTS
$7895                E5 B9      SBC $B9
$7897                85 B8      STA $B8
$7899                A9 30      LDA #$30
$789B                D0 0E      BNE $78AB
$789D                E5 B9      SBC $B9
$789F                85 B8      STA $B8
$78A1                A9 3C      LDA #$3C
$78A3                D0 06      BNE $78AB
$78A5                E5 B9      SBC $B9
$78A7                85 B8      STA $B8
$78A9                A9 3F      LDA #$3F
$78AB                20 26 7D   JSR $7D26
$78AE                EA         NOP
$78AF                A5 9A      LDA $9A
$78B1                18         CLC
$78B2                E9 03      SBC #$03
$78B4                85 9A      STA $9A
$78B6                C5 BC      CMP $BC
$78B8                B0 03      BCS $78BD
$78BA                20 A6 79   JSR $79A6
$78BD                A9 40      LDA #$40
$78BF                18         CLC
$78C0                D0 C8      BNE $788A
$78C2                A5 B8      LDA $B8
$78C4                65 BA      ADC $BA
$78C6                B0 1B      BCS $78E3
$78C8                CA         DEX
$78C9                F0 12      BEQ $78DD
$78CB                65 BA      ADC $BA
$78CD                B0 2E      BCS $78FD
$78CF                D0 4E      BNE $791F
$78D1                CA         DEX
$78D2                F0 0C      BEQ $78E0
$78D4                A5 B8      LDA $B8
$78D6                18         CLC
$78D7                65 BA      ADC $BA
$78D9                B0 2A      BCS $7905
$78DB                D0 58      BNE $7935
$78DD                A9 07      LDA #$07
$78DF                60         RTS
$78E0                A9 06      LDA #$06
$78E2                60         RTS
$78E3                E5 B9      SBC $B9
$78E5                85 B8      STA $B8
$78E7                A9 01      LDA #$01
$78E9                20 26 7D   JSR $7D26
$78EC                EA         NOP
$78ED                A5 9A      LDA $9A
$78EF                18         CLC
$78F0                E9 03      SBC #$03
$78F2                85 9A      STA $9A
$78F4                C5 BC      CMP $BC
$78F6                B0 D9      BCS $78D1
$78F8                20 A6 79   JSR $79A6
$78FB                B0 D4      BCS $78D1
$78FD                E5 B9      SBC $B9
$78FF                85 B8      STA $B8
$7901                A9 07      LDA #$07
$7903                D0 06      BNE $790B
$7905                E5 B9      SBC $B9
$7907                85 B8      STA $B8
$7909                A9 06      LDA #$06
$790B                20 26 7D   JSR $7D26
$790E                EA         NOP
$790F                A5 9A      LDA $9A
$7911                18         CLC
$7912                E9 03      SBC #$03
$7914                85 9A      STA $9A
$7916                C5 BC      CMP $BC
$7918                B0 28      BCS $7942
$791A                20 A6 79   JSR $79A6
$791D                B0 23      BCS $7942
$791F                CA         DEX
$7920                F0 0D      BEQ $792F
$7922                65 BA      ADC $BA
$7924                B0 4C      BCS $7972
$7926                85 B8      STA $B8
$7928                A9 7F      LDA #$7F
$792A                10 24      BPL $7950
$792C                A9 1E      LDA #$1E
$792E                60         RTS
$792F                A9 1F      LDA #$1F
$7931                60         RTS
$7932                A9 18      LDA #$18
$7934                60         RTS
$7935                CA         DEX
$7936                F0 F4      BEQ $792C
$7938                65 BA      ADC $BA
$793A                B0 2E      BCS $796A
$793C                85 B8      STA $B8
$793E                A9 7E      LDA #$7E
$7940                10 0E      BPL $7950
$7942                CA         DEX
$7943                F0 ED      BEQ $7932
$7945                A5 B8      LDA $B8
$7947                18         CLC
$7948                65 BA      ADC $BA
$794A                B0 16      BCS $7962
$794C                85 B8      STA $B8
$794E                A9 78      LDA #$78
$7950                20 26 7D   JSR $7D26
$7953                EA         NOP
$7954                C8         INY
$7955                CA         DEX
$7956                F0 36      BEQ $798E
$7958                A5 B8      LDA $B8
$795A                18         CLC
$795B                65 BA      ADC $BA
$795D                B0 32      BCS $7991
$795F                4C F7 77   JMP $77F7
$7962                E5 B9      SBC $B9
$7964                85 B8      STA $B8
$7966                A9 18      LDA #$18
$7968                D0 0E      BNE $7978
$796A                E5 B9      SBC $B9
$796C                85 B8      STA $B8
$796E                A9 1E      LDA #$1E
$7970                D0 06      BNE $7978
$7972                E5 B9      SBC $B9
$7974                85 B8      STA $B8
$7976                A9 1F      LDA #$1F
$7978                20 26 7D   JSR $7D26
$797B                EA         NOP
$797C                A5 9A      LDA $9A
$797E                18         CLC
$797F                E9 03      SBC #$03
$7981                85 9A      STA $9A
$7983                C5 BC      CMP $BC
$7985                B0 03      BCS $798A
$7987                20 A6 79   JSR $79A6
$798A                A9 60      LDA #$60
$798C                D0 C2      BNE $7950
$798E                68         PLA
$798F                68         PLA
$7990                60         RTS
$7991                E5 B9      SBC $B9
$7993                85 B8      STA $B8
$7995                A5 9A      LDA $9A
$7997                18         CLC
$7998                E9 03      SBC #$03
$799A                85 9A      STA $9A
$799C                C5 BC      CMP $BC
$799E                B0 03      BCS $79A3
$79A0                20 A6 79   JSR $79A6
$79A3                4C F5 77   JMP $77F5
$79A6                C9 1C      CMP #$1C
$79A8                F0 0D      BEQ $79B7
$79AA                18         CLC
$79AB                98         TYA
$79AC                69 80      ADC #$80
$79AE                A8         TAY
$79AF                A5 9A      LDA $9A
$79B1                69 1F      ADC #$1F
$79B3                85 9A      STA $9A
$79B5                38         SEC
$79B6                60         RTS
$79B7                98         TYA
$79B8                C9 80      CMP #$80
$79BA                18         CLC
$79BB                10 EF      BPL $79AC
$79BD                69 58      ADC #$58
$79BF                A8         TAY
$79C0                A5 9A      LDA $9A
$79C2                69 23      ADC #$23
$79C4                85 9A      STA $9A
$79C6                38         SEC
$79C7                60         RTS
$79C8                A9 00      LDA #$00
$79CA                38         SEC
$79CB                E5 B9      SBC $B9
$79CD                38         SEC
$79CE                6A         ROR A
$79CF                85 B8      STA $B8
$79D1                A6 B3      LDX $B3
$79D3                A4 B4      LDY $B4
$79D5                18         CLC
$79D6                B9 23 72   LDA $7223,Y
$79D9                65 BB      ADC $BB
$79DB                85 9A      STA $9A
$79DD                B9 23 73   LDA $7323,Y
$79E0                18         CLC
$79E1                7D 23 74   ADC $7423,X
$79E4                A8         TAY
$79E5                BD 23 75   LDA $7523,X
$79E8                85 B7      STA $B7
$79EA                A6 B9      LDX $B9
$79EC                E8         INX
$79ED                29 7F      AND #$7F
$79EF                C9 18      CMP #$18
$79F1                30 1C      BMI $7A0F
$79F3                F0 15      BEQ $7A0A
$79F5                C9 40      CMP #$40
$79F7                30 07      BMI $7A00
$79F9                F0 0A      BEQ $7A05
$79FB                20 BC 7B   JSR $7BBC
$79FE                D0 22      BNE $7A22
$7A00                20 AE 7A   JSR $7AAE
$7A03                D0 1D      BNE $7A22
$7A05                20 EF 7A   JSR $7AEF
$7A08                D0 18      BNE $7A22
$7A0A                20 74 7B   JSR $7B74
$7A0D                D0 13      BNE $7A22
$7A0F                C9 06      CMP #$06
$7A11                30 07      BMI $7A1A
$7A13                F0 0A      BEQ $7A1F
$7A15                20 3A 7A   JSR $7A3A
$7A18                D0 08      BNE $7A22
$7A1A                20 27 7A   JSR $7A27
$7A1D                D0 03      BNE $7A22
$7A1F                20 03 7B   JSR $7B03
$7A22                20 26 7D   JSR $7D26
$7A25                EA         NOP
$7A26                60         RTS
$7A27                A5 B8      LDA $B8
$7A29                CA         DEX
$7A2A                F0 1A      BEQ $7A46
$7A2C                18         CLC
$7A2D                65 BA      ADC $BA
$7A2F                B0 1E      BCS $7A4F
$7A31                CA         DEX
$7A32                F0 15      BEQ $7A49
$7A34                65 BA      ADC $BA
$7A36                B0 31      BCS $7A69
$7A38                D0 51      BNE $7A8B
$7A3A                CA         DEX
$7A3B                F0 0F      BEQ $7A4C
$7A3D                A5 B8      LDA $B8
$7A3F                18         CLC
$7A40                65 BA      ADC $BA
$7A42                B0 2D      BCS $7A71
$7A44                D0 5B      BNE $7AA1
$7A46                A9 03      LDA #$03
$7A48                60         RTS
$7A49                A9 0F      LDA #$0F
$7A4B                60         RTS
$7A4C                A9 0C      LDA #$0C
$7A4E                60         RTS
$7A4F                E5 B9      SBC $B9
$7A51                85 B8      STA $B8
$7A53                A9 03      LDA #$03
$7A55                20 26 7D   JSR $7D26
$7A58                EA         NOP
$7A59                A5 9A      LDA $9A
$7A5B                18         CLC
$7A5C                69 04      ADC #$04
$7A5E                85 9A      STA $9A
$7A60                C5 BD      CMP $BD
$7A62                90 D6      BCC $7A3A
$7A64                20 D8 7B   JSR $7BD8
$7A67                B0 D1      BCS $7A3A
$7A69                E5 B9      SBC $B9
$7A6B                85 B8      STA $B8
$7A6D                A9 0F      LDA #$0F
$7A6F                D0 06      BNE $7A77
$7A71                E5 B9      SBC $B9
$7A73                85 B8      STA $B8
$7A75                A9 0C      LDA #$0C
$7A77                20 26 7D   JSR $7D26
$7A7A                EA         NOP
$7A7B                A5 9A      LDA $9A
$7A7D                18         CLC
$7A7E                69 04      ADC #$04
$7A80                85 9A      STA $9A
$7A82                C5 BD      CMP $BD
$7A84                90 28      BCC $7AAE
$7A86                20 D8 7B   JSR $7BD8
$7A89                B0 23      BCS $7AAE
$7A8B                CA         DEX
$7A8C                F0 0D      BEQ $7A9B
$7A8E                65 BA      ADC $BA
$7A90                B0 45      BCS $7AD7
$7A92                85 B8      STA $B8
$7A94                A9 7F      LDA #$7F
$7A96                10 24      BPL $7ABC
$7A98                A9 3C      LDA #$3C
$7A9A                60         RTS
$7A9B                A9 3F      LDA #$3F
$7A9D                60         RTS
$7A9E                A9 30      LDA #$30
$7AA0                60         RTS
$7AA1                CA         DEX
$7AA2                F0 F4      BEQ $7A98
$7AA4                65 BA      ADC $BA
$7AA6                B0 27      BCS $7ACF
$7AA8                85 B8      STA $B8
$7AAA                A9 7C      LDA #$7C
$7AAC                10 0E      BPL $7ABC
$7AAE                CA         DEX
$7AAF                F0 ED      BEQ $7A9E
$7AB1                A5 B8      LDA $B8
$7AB3                18         CLC
$7AB4                65 BA      ADC $BA
$7AB6                B0 0F      BCS $7AC7
$7AB8                85 B8      STA $B8
$7ABA                A9 70      LDA #$70
$7ABC                20 26 7D   JSR $7D26
$7ABF                EA         NOP
$7AC0                C8         INY
$7AC1                CA         DEX
$7AC2                D0 30      BNE $7AF4
$7AC4                A9 01      LDA #$01
$7AC6                60         RTS
$7AC7                E5 B9      SBC $B9
$7AC9                85 B8      STA $B8
$7ACB                A9 30      LDA #$30
$7ACD                D0 0E      BNE $7ADD
$7ACF                E5 B9      SBC $B9
$7AD1                85 B8      STA $B8
$7AD3                A9 3C      LDA #$3C
$7AD5                D0 06      BNE $7ADD
$7AD7                E5 B9      SBC $B9
$7AD9                85 B8      STA $B8
$7ADB                A9 3F      LDA #$3F
$7ADD                20 26 7D   JSR $7D26
$7AE0                EA         NOP
$7AE1                A5 9A      LDA $9A
$7AE3                18         CLC
$7AE4                69 04      ADC #$04
$7AE6                85 9A      STA $9A
$7AE8                C5 BD      CMP $BD
$7AEA                90 03      BCC $7AEF
$7AEC                20 D8 7B   JSR $7BD8
$7AEF                A9 40      LDA #$40
$7AF1                18         CLC
$7AF2                D0 C8      BNE $7ABC
$7AF4                A5 B8      LDA $B8
$7AF6                65 BA      ADC $BA
$7AF8                B0 1B      BCS $7B15
$7AFA                CA         DEX
$7AFB                F0 12      BEQ $7B0F
$7AFD                65 BA      ADC $BA
$7AFF                B0 2E      BCS $7B2F
$7B01                D0 4E      BNE $7B51
$7B03                CA         DEX
$7B04                F0 0C      BEQ $7B12
$7B06                A5 B8      LDA $B8
$7B08                18         CLC
$7B09                65 BA      ADC $BA
$7B0B                B0 2A      BCS $7B37
$7B0D                D0 58      BNE $7B67
$7B0F                A9 07      LDA #$07
$7B11                60         RTS
$7B12                A9 06      LDA #$06
$7B14                60         RTS
$7B15                E5 B9      SBC $B9
$7B17                85 B8      STA $B8
$7B19                A9 01      LDA #$01
$7B1B                20 26 7D   JSR $7D26
$7B1E                EA         NOP
$7B1F                A5 9A      LDA $9A
$7B21                18         CLC
$7B22                69 04      ADC #$04
$7B24                85 9A      STA $9A
$7B26                C5 BD      CMP $BD
$7B28                90 D9      BCC $7B03
$7B2A                20 D8 7B   JSR $7BD8
$7B2D                B0 D4      BCS $7B03
$7B2F                E5 B9      SBC $B9
$7B31                85 B8      STA $B8
$7B33                A9 07      LDA #$07
$7B35                D0 06      BNE $7B3D
$7B37                E5 B9      SBC $B9
$7B39                85 B8      STA $B8
$7B3B                A9 06      LDA #$06
$7B3D                20 26 7D   JSR $7D26
$7B40                EA         NOP
$7B41                A5 9A      LDA $9A
$7B43                18         CLC
$7B44                69 04      ADC #$04
$7B46                85 9A      STA $9A
$7B48                C5 BD      CMP $BD
$7B4A                90 28      BCC $7B74
$7B4C                20 D8 7B   JSR $7BD8
$7B4F                B0 23      BCS $7B74
$7B51                CA         DEX
$7B52                F0 0D      BEQ $7B61
$7B54                65 BA      ADC $BA
$7B56                B0 4C      BCS $7BA4
$7B58                85 B8      STA $B8
$7B5A                A9 7F      LDA #$7F
$7B5C                10 24      BPL $7B82
$7B5E                A9 1E      LDA #$1E
$7B60                60         RTS
$7B61                A9 1F      LDA #$1F
$7B63                60         RTS
$7B64                A9 18      LDA #$18
$7B66                60         RTS
$7B67                CA         DEX
$7B68                F0 F4      BEQ $7B5E
$7B6A                65 BA      ADC $BA
$7B6C                B0 2E      BCS $7B9C
$7B6E                85 B8      STA $B8
$7B70                A9 7E      LDA #$7E
$7B72                10 0E      BPL $7B82
$7B74                CA         DEX
$7B75                F0 ED      BEQ $7B64
$7B77                A5 B8      LDA $B8
$7B79                18         CLC
$7B7A                65 BA      ADC $BA
$7B7C                B0 16      BCS $7B94
$7B7E                85 B8      STA $B8
$7B80                A9 78      LDA #$78
$7B82                20 26 7D   JSR $7D26
$7B85                EA         NOP
$7B86                C8         INY
$7B87                CA         DEX
$7B88                F0 36      BEQ $7BC0
$7B8A                A5 B8      LDA $B8
$7B8C                18         CLC
$7B8D                65 BA      ADC $BA
$7B8F                B0 32      BCS $7BC3
$7B91                4C 29 7A   JMP $7A29
$7B94                E5 B9      SBC $B9
$7B96                85 B8      STA $B8
$7B98                A9 18      LDA #$18
$7B9A                D0 0E      BNE $7BAA
$7B9C                E5 B9      SBC $B9
$7B9E                85 B8      STA $B8
$7BA0                A9 1E      LDA #$1E
$7BA2                D0 06      BNE $7BAA
$7BA4                E5 B9      SBC $B9
$7BA6                85 B8      STA $B8
$7BA8                A9 1F      LDA #$1F
$7BAA                20 26 7D   JSR $7D26
$7BAD                EA         NOP
$7BAE                A5 9A      LDA $9A
$7BB0                18         CLC
$7BB1                69 04      ADC #$04
$7BB3                85 9A      STA $9A
$7BB5                C5 BD      CMP $BD
$7BB7                90 03      BCC $7BBC
$7BB9                20 D8 7B   JSR $7BD8
$7BBC                A9 60      LDA #$60
$7BBE                D0 C2      BNE $7B82
$7BC0                68         PLA
$7BC1                68         PLA
$7BC2                60         RTS
$7BC3                E5 B9      SBC $B9
$7BC5                85 B8      STA $B8
$7BC7                A5 9A      LDA $9A
$7BC9                18         CLC
$7BCA                69 04      ADC #$04
$7BCC                85 9A      STA $9A
$7BCE                C5 BD      CMP $BD
$7BD0                90 03      BCC $7BD5
$7BD2                20 D8 7B   JSR $7BD8
$7BD5                4C 27 7A   JMP $7A27
$7BD8                C9 43      CMP #$43
$7BDA                F0 0D      BEQ $7BE9
$7BDC                38         SEC
$7BDD                98         TYA
$7BDE                E9 80      SBC #$80
$7BE0                A8         TAY
$7BE1                A5 9A      LDA $9A
$7BE3                E9 1F      SBC #$1F
$7BE5                85 9A      STA $9A
$7BE7                38         SEC
$7BE8                60         RTS
$7BE9                98         TYA
$7BEA                C9 80      CMP #$80
$7BEC                38         SEC
$7BED                30 EF      BMI $7BDE
$7BEF                E9 58      SBC #$58
$7BF1                A8         TAY
$7BF2                A5 9A      LDA $9A
$7BF4                E9 23      SBC #$23
$7BF6                85 9A      STA $9A
$7BF8                38         SEC
$7BF9                60         RTS
$7BFA                A5 BA      LDA $BA
$7BFC                18         CLC
$7BFD                6A         ROR A
$7BFE                85 B8      STA $B8
$7C00                A6 B3      LDX $B3
$7C02                A4 B4      LDY $B4
$7C04                18         CLC
$7C05                B9 23 72   LDA $7223,Y
$7C08                65 BB      ADC $BB
$7C0A                85 9A      STA $9A
$7C0C                B9 23 73   LDA $7323,Y
$7C0F                18         CLC
$7C10                7D 23 74   ADC $7423,X
$7C13                A8         TAY
$7C14                BD 23 75   LDA $7523,X
$7C17                85 B7      STA $B7
$7C19                A6 BA      LDX $BA
$7C1B                E8         INX
$7C1C                A5 B7      LDA $B7
$7C1E                30 32      BMI $7C52
$7C20                20 26 7D   JSR $7D26
$7C23                EA         NOP
$7C24                CA         DEX
$7C25                F0 2A      BEQ $7C51
$7C27                A5 9A      LDA $9A
$7C29                38         SEC
$7C2A                E9 04      SBC #$04
$7C2C                C9 20      CMP #$20
$7C2E                90 37      BCC $7C67
$7C30                85 9A      STA $9A
$7C32                A5 B8      LDA $B8
$7C34                38         SEC
$7C35                E5 B9      SBC $B9
$7C37                85 B8      STA $B8
$7C39                B0 E1      BCS $7C1C
$7C3B                65 BA      ADC $BA
$7C3D                85 B8      STA $B8
$7C3F                18         CLC
$7C40                A5 B7      LDA $B7
$7C42                30 47      BMI $7C8B
$7C44                2A         ROL A
$7C45                2A         ROL A
$7C46                30 16      BMI $7C5E
$7C48                85 B7      STA $B7
$7C4A                20 26 7D   JSR $7D26
$7C4D                EA         NOP
$7C4E                CA         DEX
$7C4F                D0 D6      BNE $7C27
$7C51                60         RTS
$7C52                C8         INY
$7C53                A9 01      LDA #$01
$7C55                20 26 7D   JSR $7D26
$7C58                EA         NOP
$7C59                88         DEY
$7C5A                A9 C0      LDA #$C0
$7C5C                30 C2      BMI $7C20
$7C5E                C9 80      CMP #$80
$7C60                D0 23      BNE $7C85
$7C62                C8         INY
$7C63                A9 03      LDA #$03
$7C65                10 E1      BPL $7C48
$7C67                C9 1C      CMP #$1C
$7C69                F0 0B      BEQ $7C76
$7C6B                18         CLC
$7C6C                98         TYA
$7C6D                69 80      ADC #$80
$7C6F                A8         TAY
$7C70                A5 9A      LDA $9A
$7C72                69 1B      ADC #$1B
$7C74                90 BA      BCC $7C30
$7C76                98         TYA
$7C77                C9 80      CMP #$80
$7C79                18         CLC
$7C7A                10 F1      BPL $7C6D
$7C7C                69 58      ADC #$58
$7C7E                A8         TAY
$7C7F                A5 9A      LDA $9A
$7C81                69 1F      ADC #$1F
$7C83                90 AB      BCC $7C30
$7C85                A9 C0      LDA #$C0
$7C87                85 B7      STA $B7
$7C89                30 C7      BMI $7C52
$7C8B                C8         INY
$7C8C                A9 06      LDA #$06
$7C8E                D0 B8      BNE $7C48
$7C90                A5 BA      LDA $BA
$7C92                18         CLC
$7C93                6A         ROR A
$7C94                85 B8      STA $B8
$7C96                A6 B3      LDX $B3
$7C98                A4 B4      LDY $B4
$7C9A                18         CLC
$7C9B                B9 23 72   LDA $7223,Y
$7C9E                65 BB      ADC $BB
$7CA0                85 9A      STA $9A
$7CA2                B9 23 73   LDA $7323,Y
$7CA5                18         CLC
$7CA6                7D 23 74   ADC $7423,X
$7CA9                A8         TAY
$7CAA                BD 23 75   LDA $7523,X
$7CAD                85 B7      STA $B7
$7CAF                A6 BA      LDX $BA
$7CB1                E8         INX
$7CB2                A5 B7      LDA $B7
$7CB4                30 32      BMI $7CE8
$7CB6                20 26 7D   JSR $7D26
$7CB9                EA         NOP
$7CBA                CA         DEX
$7CBB                F0 2A      BEQ $7CE7
$7CBD                A5 9A      LDA $9A
$7CBF                18         CLC
$7CC0                69 04      ADC #$04
$7CC2                C9 40      CMP #$40
$7CC4                B0 37      BCS $7CFD
$7CC6                85 9A      STA $9A
$7CC8                A5 B8      LDA $B8
$7CCA                38         SEC
$7CCB                E5 B9      SBC $B9
$7CCD                85 B8      STA $B8
$7CCF                B0 E1      BCS $7CB2
$7CD1                65 BA      ADC $BA
$7CD3                85 B8      STA $B8
$7CD5                18         CLC
$7CD6                A5 B7      LDA $B7
$7CD8                30 47      BMI $7D21
$7CDA                2A         ROL A
$7CDB                2A         ROL A
$7CDC                30 16      BMI $7CF4
$7CDE                85 B7      STA $B7
$7CE0                20 26 7D   JSR $7D26
$7CE3                EA         NOP
$7CE4                CA         DEX
$7CE5                D0 D6      BNE $7CBD
$7CE7                60         RTS
$7CE8                C8         INY
$7CE9                A9 01      LDA #$01
$7CEB                20 26 7D   JSR $7D26
$7CEE                EA         NOP
$7CEF                88         DEY
$7CF0                A9 C0      LDA #$C0
$7CF2                30 C2      BMI $7CB6
$7CF4                C9 80      CMP #$80
$7CF6                D0 23      BNE $7D1B
$7CF8                C8         INY
$7CF9                A9 03      LDA #$03
$7CFB                10 E1      BPL $7CDE
$7CFD                C9 43      CMP #$43
$7CFF                F0 0B      BEQ $7D0C
$7D01                38         SEC
$7D02                98         TYA
$7D03                E9 80      SBC #$80
$7D05                A8         TAY
$7D06                A5 9A      LDA $9A
$7D08                E9 1B      SBC #$1B
$7D0A                B0 BA      BCS $7CC6
$7D0C                98         TYA
$7D0D                C9 80      CMP #$80
$7D0F                38         SEC
$7D10                30 F1      BMI $7D03
$7D12                E9 58      SBC #$58
$7D14                A8         TAY
$7D15                A5 9A      LDA $9A
$7D17                E9 1F      SBC #$1F
$7D19                B0 AB      BCS $7CC6
$7D1B                A9 C0      LDA #$C0
$7D1D                85 B7      STA $B7
$7D1F                30 C7      BMI $7CE8
$7D21                C8         INY
$7D22                A9 06      LDA #$06
$7D24                D0 B8      BNE $7CDE
$7D26                85 A9      STA $A9
$7D28                49 FF      EOR #$FF
$7D2A                31 99      AND ($99),Y
$7D2C                09 80      ORA #$80
$7D2E                85 A3      STA $A3
$7D30                98         TYA
$7D31                6A         ROR A
$7D32                B0 09      BCS $7D3D
$7D34                A5 A9      LDA $A9
$7D36                25 BE      AND $BE
$7D38                05 A3      ORA $A3
$7D3A                91 99      STA ($99),Y
$7D3C                60         RTS
$7D3D                A5 A9      LDA $A9
$7D3F                25 BF      AND $BF
$7D41                05 A3      ORA $A3
$7D43                91 99      STA ($99),Y
$7D45                60         RTS
$7D46  OP09:         C8         INY
$7D47                B1 9B      LDA ($9B),Y
$7D49                F0 02      BEQ $7D4D
$7D4B                A9 20      LDA #$20
$7D4D                85 BB      STA $BB
$7D4F                18         CLC
$7D50                69 20      ADC #$20
$7D52                8D 2D 7C   STA $7C2D
$7D55                85 BC      STA $BC
$7D57                38         SEC
$7D58                E9 04      SBC #$04
$7D5A                8D A7 79   STA $79A7
$7D5D                8D 68 7C   STA $7C68
$7D60                18         CLC
$7D61                69 24      ADC #$24
$7D63                8D C3 7C   STA $7CC3
$7D66                85 BD      STA $BD
$7D68                18         CLC
$7D69                69 03      ADC #$03
$7D6B                8D D9 7B   STA $7BD9
$7D6E                8D FE 7C   STA $7CFE
$7D71                4C B5 63   JMP ADV2
$7D74  OP18:         A5 7D      LDA $7D
$7D76                F0 03      BEQ $7D7B
$7D78                4C C1 60   JMP EMIT2
$7D7B                C8         INY
$7D7C                B1 9B      LDA ($9B),Y
$7D7E                F0 26      BEQ $7DA6
$7D80                C9 01      CMP #$01
$7D82                F0 1C      BEQ $7DA0
$7D84                C9 02      CMP #$02
$7D86                F0 37      BEQ $7DBF
$7D88                C9 03      CMP #$03
$7D8A                D0 06      BNE $7D92
$7D8C                A9 55      LDA #$55
$7D8E                A2 2A      LDX #$2A
$7D90                D0 04      BNE $7D96
$7D92                A9 2A      LDA #$2A
$7D94                A2 55      LDX #$55
$7D96                85 BE      STA $BE
$7D98                86 BF      STX $BF
$7D9A                A9 09      LDA #$09
$7D9C                A2 80      LDX #$80
$7D9E                D0 2B      BNE $7DCB
$7DA0                A9 2A      LDA #$2A
$7DA2                A2 55      LDX #$55
$7DA4                D0 1D      BNE $7DC3
$7DA6                A2 00      LDX #$00
$7DA8                A9 11      LDA #$11
$7DAA                20 ED 7D   JSR $7DED
$7DAD                E8         INX
$7DAE                A9 99      LDA #$99
$7DB0                20 ED 7D   JSR $7DED
$7DB3                E8         INX
$7DB4                A9 91      LDA #$91
$7DB6                20 ED 7D   JSR $7DED
$7DB9                E8         INX
$7DBA                A9 99      LDA #$99
$7DBC                4C E7 7D   JMP $7DE7
$7DBF                A9 55      LDA #$55
$7DC1                A2 2A      LDX #$2A
$7DC3                85 BE      STA $BE
$7DC5                86 BF      STX $BF
$7DC7                A9 29      LDA #$29
$7DC9                A2 7F      LDX #$7F
$7DCB                8D 2C 7D   STA $7D2C
$7DCE                8E 2D 7D   STX $7D2D
$7DD1                A2 00      LDX #$00
$7DD3                A9 20      LDA #$20
$7DD5                20 ED 7D   JSR $7DED
$7DD8                E8         INX
$7DD9                A9 26      LDA #$26
$7DDB                20 ED 7D   JSR $7DED
$7DDE                E8         INX
$7DDF                A9 7D      LDA #$7D
$7DE1                20 ED 7D   JSR $7DED
$7DE4                E8         INX
$7DE5                A9 EA      LDA #$EA
$7DE7                20 ED 7D   JSR $7DED
$7DEA                4C B5 63   JMP ADV2
$7DED                9D F0 77   STA $77F0,X
$7DF0                9D 23 78   STA $7823,X
$7DF3                9D 45 78   STA $7845,X
$7DF6                9D 8A 78   STA $788A,X
$7DF9                9D AB 78   STA $78AB,X
$7DFC                9D E9 78   STA $78E9,X
$7DFF                9D 0B 79   STA $790B,X
$7E02                9D 50 79   STA $7950,X
$7E05                9D 78 79   STA $7978,X
$7E08                9D 20 7C   STA $7C20,X
$7E0B                9D 4A 7C   STA $7C4A,X
$7E0E                9D 55 7C   STA $7C55,X
$7E11                9D B6 7C   STA $7CB6,X
$7E14                9D E0 7C   STA $7CE0,X
$7E17                9D EB 7C   STA $7CEB,X
$7E1A                9D 22 7A   STA $7A22,X
$7E1D                9D 55 7A   STA $7A55,X
$7E20                9D 77 7A   STA $7A77,X
$7E23                9D BC 7A   STA $7ABC,X
$7E26                9D DD 7A   STA $7ADD,X
$7E29                9D 1B 7B   STA $7B1B,X
$7E2C                9D 3D 7B   STA $7B3D,X
$7E2F                9D 82 7B   STA $7B82,X
$7E32                9D AA 7B   STA $7BAA,X
$7E35                9D 34 77   STA $7734,X
$7E38                9D 39 77   STA $7739,X
$7E3B                60         RTS
$7E3C                .byte $A9, $00, $85, $A3, $85, $A4
$7E42                A5 A3      LDA $A3
$7E44                38         SEC
$7E45                E5 A4      SBC $A4
$7E47                85 A5      STA $A5
$7E49                A5 B5      LDA $B5
$7E4B                E5 B3      SBC $B3
$7E4D                50 03      BVC $7E52
$7E4F                4C F8 7F   JMP $7FF8
$7E52                30 36      BMI $7E8A
$7E54                85 B9      STA $B9
$7E56                A5 B6      LDA $B6
$7E58                38         SEC
$7E59                E5 B4      SBC $B4
$7E5B                30 14      BMI $7E71
$7E5D                70 14      BVS $7E73
$7E5F                85 BA      STA $BA
$7E61                26 A5      ROL $A5
$7E63                26 B9      ROL $B9
$7E65                A5 BA      LDA $BA
$7E67                E5 B9      SBC $B9
$7E69                B0 03      BCS $7E6E
$7E6B                4C DA 7E   JMP $7EDA
$7E6E                4C 24 7F   JMP $7F24
$7E71                70 EC      BVS $7E5F
$7E73                49 FF      EOR #$FF
$7E75                18         CLC
$7E76                69 01      ADC #$01
$7E78                85 BA      STA $BA
$7E7A                26 A5      ROL $A5
$7E7C                26 B9      ROL $B9
$7E7E                A5 BA      LDA $BA
$7E80                E5 B9      SBC $B9
$7E82                90 03      BCC $7E87
$7E84                4C 69 7F   JMP $7F69
$7E87                4C AE 7F   JMP $7FAE
$7E8A                85 B9      STA $B9
$7E8C                A5 A4      LDA $A4
$7E8E                38         SEC
$7E8F                E5 A3      SBC $A3
$7E91                85 A5      STA $A5
$7E93                A5 B3      LDA $B3
$7E95                E5 B5      SBC $B5
$7E97                85 B9      STA $B9
$7E99                A6 A3      LDX $A3
$7E9B                86 A4      STX $A4
$7E9D                A6 B5      LDX $B5
$7E9F                86 B3      STX $B3
$7EA1                A5 B4      LDA $B4
$7EA3                A6 B6      LDX $B6
$7EA5                38         SEC
$7EA6                E5 B6      SBC $B6
$7EA8                86 B4      STX $B4
$7EAA                4C 5B 7E   JMP $7E5B
$7EAD                18         CLC
$7EAE                B9 23 72   LDA $7223,Y
$7EB1                65 BB      ADC $BB
$7EB3                85 9A      STA $9A
$7EB5                B9 23 73   LDA $7323,Y
$7EB8                18         CLC
$7EB9                7D 23 74   ADC $7423,X
$7EBC                A8         TAY
$7EBD                4A         LSR A
$7EBE                6A         ROR A
$7EBF                45 A4      EOR $A4
$7EC1                30 04      BMI $7EC7
$7EC3                A9 55      LDA #$55
$7EC5                D0 0D      BNE $7ED4
$7EC7                A9 2A      LDA #$2A
$7EC9                3D 23 75   AND $7523,X
$7ECC                D0 03      BNE $7ED1
$7ECE                C8         INY
$7ECF                A9 01      LDA #$01
$7ED1                85 B7      STA $B7
$7ED3                60         RTS
$7ED4                3D 23 75   AND $7523,X
$7ED7                85 B7      STA $B7
$7ED9                60         RTS
$7EDA                A9 00      LDA #$00
$7EDC                38         SEC
$7EDD                E5 B9      SBC $B9
$7EDF                38         SEC
$7EE0                6A         ROR A
$7EE1                85 B8      STA $B8
$7EE3                A6 B3      LDX $B3
$7EE5                A4 B4      LDY $B4
$7EE7                20 AD 7E   JSR $7EAD
$7EEA                A6 B9      LDX $B9
$7EEC                E8         INX
$7EED                A5 B7      LDA $B7
$7EEF                11 99      ORA ($99),Y
$7EF1                91 99      STA ($99),Y
$7EF3                CA         DEX
$7EF4                F0 2D      BEQ $7F23
$7EF6                06 B7      ASL $B7
$7EF8                30 21      BMI $7F1B
$7EFA                A5 B8      LDA $B8
$7EFC                65 BA      ADC $BA
$7EFE                B0 05      BCS $7F05
$7F00                85 B8      STA $B8
$7F02                4C ED 7E   JMP $7EED
$7F05                38         SEC
$7F06                E5 B9      SBC $B9
$7F08                85 B8      STA $B8
$7F0A                A5 9A      LDA $9A
$7F0C                38         SEC
$7F0D                E9 04      SBC #$04
$7F0F                85 9A      STA $9A
$7F11                C5 BC      CMP $BC
$7F13                B0 D8      BCS $7EED
$7F15                20 A6 79   JSR $79A6
$7F18                4C ED 7E   JMP $7EED
$7F1B                C8         INY
$7F1C                A9 01      LDA #$01
$7F1E                85 B7      STA $B7
$7F20                4C FA 7E   JMP $7EFA
$7F23                60         RTS
$7F24                A5 BA      LDA $BA
$7F26                18         CLC
$7F27                6A         ROR A
$7F28                85 B8      STA $B8
$7F2A                A6 B3      LDX $B3
$7F2C                A4 B4      LDY $B4
$7F2E                20 AD 7E   JSR $7EAD
$7F31                A6 BA      LDX $BA
$7F33                E8         INX
$7F34                A5 B7      LDA $B7
$7F36                11 99      ORA ($99),Y
$7F38                91 99      STA ($99),Y
$7F3A                CA         DEX
$7F3B                F0 2B      BEQ $7F68
$7F3D                A5 9A      LDA $9A
$7F3F                38         SEC
$7F40                E9 04      SBC #$04
$7F42                85 9A      STA $9A
$7F44                C5 BC      CMP $BC
$7F46                B0 03      BCS $7F4B
$7F48                20 A6 79   JSR $79A6
$7F4B                A5 B8      LDA $B8
$7F4D                38         SEC
$7F4E                E5 B9      SBC $B9
$7F50                85 B8      STA $B8
$7F52                B0 E0      BCS $7F34
$7F54                65 BA      ADC $BA
$7F56                85 B8      STA $B8
$7F58                A5 B7      LDA $B7
$7F5A                0A         ASL A
$7F5B                30 04      BMI $7F61
$7F5D                85 B7      STA $B7
$7F5F                D0 D3      BNE $7F34
$7F61                C8         INY
$7F62                A9 01      LDA #$01
$7F64                85 B7      STA $B7
$7F66                D0 CC      BNE $7F34
$7F68                60         RTS
$7F69                A5 BA      LDA $BA
$7F6B                18         CLC
$7F6C                6A         ROR A
$7F6D                85 B8      STA $B8
$7F6F                A6 B3      LDX $B3
$7F71                A4 B4      LDY $B4
$7F73                20 AD 7E   JSR $7EAD
$7F76                A6 BA      LDX $BA
$7F78                E8         INX
$7F79                A5 B7      LDA $B7
$7F7B                11 99      ORA ($99),Y
$7F7D                91 99      STA ($99),Y
$7F7F                CA         DEX
$7F80                F0 2B      BEQ $7FAD
$7F82                A5 9A      LDA $9A
$7F84                18         CLC
$7F85                69 04      ADC #$04
$7F87                85 9A      STA $9A
$7F89                C5 BD      CMP $BD
$7F8B                90 03      BCC $7F90
$7F8D                20 D8 7B   JSR $7BD8
$7F90                A5 B8      LDA $B8
$7F92                38         SEC
$7F93                E5 B9      SBC $B9
$7F95                85 B8      STA $B8
$7F97                B0 E0      BCS $7F79
$7F99                65 BA      ADC $BA
$7F9B                85 B8      STA $B8
$7F9D                A5 B7      LDA $B7
$7F9F                0A         ASL A
$7FA0                30 04      BMI $7FA6
$7FA2                85 B7      STA $B7
$7FA4                D0 D3      BNE $7F79
$7FA6                C8         INY
$7FA7                A9 01      LDA #$01
$7FA9                85 B7      STA $B7
$7FAB                D0 CC      BNE $7F79
$7FAD                60         RTS
$7FAE                A9 00      LDA #$00
$7FB0                38         SEC
$7FB1                E5 B9      SBC $B9
$7FB3                38         SEC
$7FB4                6A         ROR A
$7FB5                85 B8      STA $B8
$7FB7                A6 B3      LDX $B3
$7FB9                A4 B4      LDY $B4
$7FBB                20 AD 7E   JSR $7EAD
$7FBE                A6 B9      LDX $B9
$7FC0                E8         INX
$7FC1                A5 B7      LDA $B7
$7FC3                11 99      ORA ($99),Y
$7FC5                91 99      STA ($99),Y
$7FC7                CA         DEX
$7FC8                F0 2D      BEQ $7FF7
$7FCA                06 B7      ASL $B7
$7FCC                30 21      BMI $7FEF
$7FCE                A5 B8      LDA $B8
$7FD0                65 BA      ADC $BA
$7FD2                B0 05      BCS $7FD9
$7FD4                85 B8      STA $B8
$7FD6                4C C1 7F   JMP $7FC1
$7FD9                38         SEC
$7FDA                E5 B9      SBC $B9
$7FDC                85 B8      STA $B8
$7FDE                A5 9A      LDA $9A
$7FE0                18         CLC
$7FE1                69 04      ADC #$04
$7FE3                85 9A      STA $9A
$7FE5                C5 BD      CMP $BD
$7FE7                90 D8      BCC $7FC1
$7FE9                20 D8 7B   JSR $7BD8
$7FEC                4C C1 7F   JMP $7FC1
$7FEF                C8         INY
$7FF0                A9 01      LDA #$01
$7FF2                85 B7      STA $B7
$7FF4                4C CE 7F   JMP $7FCE
$7FF7                60         RTS
$7FF8                6A         ROR A
$7FF9                85 B9      STA $B9
$7FFB                66 A5      ROR $A5
$7FFD                A5 A3      LDA $A3
$7FFF                48         PHA
$8000                A5 B5      LDA $B5
$8002                48         PHA
$8003                A5 A4      LDA $A4
$8005                18         CLC
$8006                65 A5      ADC $A5
$8008                85 A3      STA $A3
$800A                48         PHA
$800B                A5 B3      LDA $B3
$800D                65 B9      ADC $B9
$800F                85 B5      STA $B5
$8011                48         PHA
$8012                A5 B6      LDA $B6
$8014                48         PHA
$8015                38         SEC
$8016                E5 B4      SBC $B4
$8018                70 02      BVS $801C
$801A                C9 80      CMP #$80
$801C                6A         ROR A
$801D                18         CLC
$801E                65 B4      ADC $B4
$8020                85 B6      STA $B6
$8022                48         PHA
$8023                20 42 7E   JSR $7E42
$8026                68         PLA
$8027                85 B4      STA $B4
$8029                68         PLA
$802A                85 B6      STA $B6
$802C                68         PLA
$802D                85 B3      STA $B3
$802F                68         PLA
$8030                85 A4      STA $A4
$8032                68         PLA
$8033                85 B5      STA $B5
$8035                68         PLA
$8036                85 A3      STA $A3
$8038                20 42 7E   JSR $7E42
$803B                60         RTS
$803C  OP20:         A5 7D      LDA $7D
$803E                D0 34      BNE $8074
$8040                C8         INY
$8041                B1 9B      LDA ($9B),Y
$8043                F0 06      BEQ $804B
$8045                20 51 80   JSR $8051
$8048                4C B5 63   JMP ADV2
$804B                20 5F 80   JSR $805F
$804E                4C B5 63   JMP ADV2
$8051                A9 3C      LDA #$3C
$8053                8D 46 77   STA $7746
$8056                A9 7E      LDA #$7E
$8058                A2 10      LDX #$10
$805A                A0 77      LDY #$77
$805C                4C 6A 80   JMP $806A
$805F                A9 48      LDA #$48
$8061                8D 46 77   STA $7746
$8064                A9 77      LDA #$77
$8066                A2 1F      LDX #$1F
$8068                A0 77      LDY #$77
$806A                8D 47 77   STA $7747
$806D                8E 1D 77   STX $771D
$8070                8C 1E 77   STY $771E
$8073                60         RTS
$8074                C8         INY
$8075                B1 9B      LDA ($9B),Y
$8077                A0 01      LDY #$01
$8079                91 9D      STA ($9D),Y
$807B                88         DEY
$807C                A9 14      LDA #$14
$807E                4C CB 60   JMP $60CB
$8081  OP12:         C8         INY
$8082                B1 9B      LDA ($9B),Y
$8084                F0 04      BEQ $808A
$8086                A9 51      LDA #$51
$8088                10 02      BPL $808C
$808A                A9 11      LDA #$11
$808C                8D 34 77   STA $7734
$808F                8D 39 77   STA $7739
$8092                8D 40 77   STA $7740
$8095                8D 22 7A   STA $7A22
$8098                8D BC 7A   STA $7ABC
$809B                8D 82 7B   STA $7B82
$809E                8D F0 77   STA $77F0
$80A1                8D 23 78   STA $7823
$80A4                8D 45 78   STA $7845
$80A7                8D 8A 78   STA $788A
$80AA                8D AB 78   STA $78AB
$80AD                8D E9 78   STA $78E9
$80B0                8D 0B 79   STA $790B
$80B3                8D 50 79   STA $7950
$80B6                8D 78 79   STA $7978
$80B9                8D 55 7A   STA $7A55
$80BC                8D 77 7A   STA $7A77
$80BF                8D DD 7A   STA $7ADD
$80C2                8D 1B 7B   STA $7B1B
$80C5                8D 3D 7B   STA $7B3D
$80C8                8D AA 7B   STA $7BAA
$80CB                8D 20 7C   STA $7C20
$80CE                8D 4A 7C   STA $7C4A
$80D1                8D 55 7C   STA $7C55
$80D4                8D B6 7C   STA $7CB6
$80D7                8D E0 7C   STA $7CE0
$80DA                8D 17 77   STA $7717
$80DD                8D EF 7E   STA $7EEF
$80E0                8D 36 7F   STA $7F36
$80E3                8D 7B 7F   STA $7F7B
$80E6                8D C3 7F   STA $7FC3
$80E9                8D EB 7C   STA $7CEB
$80EC                A5 7D      LDA $7D
$80EE                F0 08      BEQ $80F8
$80F0                A9 79      LDA #$79
$80F2                A0 00      LDY #$00
$80F4                91 9D      STA ($9D),Y
$80F6                84 7D      STY $7D
$80F8                4C B5 63   JMP ADV2
